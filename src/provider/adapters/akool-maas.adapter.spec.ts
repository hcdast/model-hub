import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AkoolMaasAdapter } from './akool-maas.adapter';
import { TaskStatus } from '../../common/constants/task-status';

describe('AKOOL MaaS HTTP protocol (local server, no supplier calls)', () => {
  let server: Server;
  let adapter: AkoolMaasAdapter;
  let reply: any;
  let requests: Array<{ url?: string; method?: string; headers: any; body: any }>;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        requests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    adapter = new AkoolMaasAdapter({ getResolvedSync: () => ({ baseUrl, extra: { llm_base_url: baseUrl.replace('/api/v1', '/llm/v1') } }), getSubmitLimitsSync: () => ({ maxConcurrent: 2, maxPerSecond: 1 }) } as any,
      { hasPool: () => true, selectAccount: async () => ({ _id: 'test-account', api_key: 'local-fixture-key' }), reportResult: async () => undefined } as any);
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
  beforeEach(() => { requests = []; reply = { task_uuid: 'upstream-task', status: 'pending' }; });

  it('preserves all input arrays and false/-1 values and reuses the task ID on retry', async () => {
    const input = { images: ['https://example.com/i.png'], videos: ['https://example.com/v.mp4'], audios: ['https://example.com/a.mp3'],
      prompt: '@Image1 follows @Video1', duration: -1, generate_audio: false, watermark: false, return_last_frame: true, resolution: '720p', ratio: 'adaptive', seed: -1, omni_reference_task_type: 'edit' };
    const request = { taskId: 'hub-task', model: 'doubao/seedance-2-5/reference-to-video', input, options: { configId: 'private-config' } };
    expect((await adapter.submitTask(request)).providerTaskId).toBe('upstream-task');
    await adapter.submitTask(request);
    expect(requests[0].url).toBe('/api/v1/run/doubao%2Fseedance-2-5%2Freference-to-video');
    expect(requests[0].body).toEqual({ input });
    expect(requests[0].headers.authorization).toBe('Bearer local-fixture-key');
    expect(requests.map(r => r.headers['idempotency-key'])).toEqual(['hub-task', 'hub-task']);
  });
  it('routes capability aliases to the configured upstream model without sending the selector as input', async () => {
    const input = { model: 'alibaba/wan-3.0/video', prompt: 'test', duration: -1, generate_audio: false };
    await adapter.submitTask({ taskId: 'wan-task', model: 'alibaba/wan-3.0/text-to-video', input });
    expect(requests[0].url).toBe('/api/v1/run/alibaba%2Fwan-3.0%2Fvideo');
    expect(requests[0].body).toEqual({ input: { prompt: 'test', duration: -1, generate_audio: false } });
    expect(input.model).toBe('alibaba/wan-3.0/video');
  });
  it('routes explicitly configured LLMs to their separate host and preserves token usage for settlement', async () => {
    reply = { id: 'chatcmpl-local', choices: [{ message: { role: 'assistant', content: '{"title":"信"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    const result = await adapter.submitTask({ taskId: 'script-task', model: 'local-script', input: { maas_protocol: 'chat-completions', model: 'verified-model', prompt: '生成分镜', max_tokens: 2048, temperature: 0, stream: false, private_metadata: 'omit' } });
    expect(requests[0].url).toBe('/llm/v1/chat/completions');
    expect(requests[0].headers.authorization).toBe('Bearer local-fixture-key');
    expect(requests[0].body).toEqual({ model: 'verified-model', messages: [{ role: 'user', content: '生成分镜' }], max_tokens: 2048, temperature: 0, stream: false });
    expect(result).toMatchObject({ providerTaskId: 'chatcmpl-local', isSync: true, result: reply });
    expect(result.rawResponse).toEqual(reply);
  });
  it('accepts a native message conversation and rejects streaming or missing LLM configuration before HTTP', async () => {
    reply = { choices: [{ message: { content: '完成' }, finish_reason: 'length' }], usage: { total_tokens: 3 } };
    const request = { taskId: 'script-task', model: 'verified-model', input: { maas_protocol: 'chat-completions', messages: [{ role: 'system', content: '编剧' }, { role: 'user', content: '故事' }] } };
    expect((await adapter.submitTask(request)).result.choices[0].finish_reason).toBe('length');
    expect(requests[0].body.messages).toEqual(request.input.messages);
    expect(requests[0].body.stream).toBe(false);
    await expect(adapter.submitTask({ ...request, input: { ...request.input, stream: true } })).rejects.toThrow('non-streaming');
    const missing = new AkoolMaasAdapter({ getResolvedSync: () => ({ baseUrl: 'https://media.example/api/v1' }) } as any, { hasPool: () => true, selectAccount: async () => ({ _id: 'test-account', api_key: 'local-fixture-key' }) } as any);
    await expect(missing.submitTask(request)).rejects.toThrow('extra.llm_base_url');
    expect(requests).toHaveLength(1);
    reply = { error: { message: 'model denied' } };
    await expect(adapter.submitTask(request)).rejects.toThrow('model denied');
  });
  it.each([['pending', 'pending'], ['processing', 'processing'], ['completed', 'succeeded'], ['failed', 'failed'], ['cancelled', 'cancelled'], ['new-status', 'unknown']])('maps %s and preserves failure reasons/output', async (status, normalized) => {
    reply = { task_uuid: 'upstream/task', status, output: { videos: ['https://example.com/out.mp4'], duration: 7 }, error_message: 'channel rejected reference', progress: 80 };
    const result = await adapter.queryTask('upstream/task');
    expect(requests[0].url).toBe('/api/v1/run/tasks/upstream%2Ftask');
    expect(result.status).toBe(normalized);
    expect(result.rawResponse).toEqual(reply);
    expect(result.result).toEqual(status === 'completed' ? reply.output : undefined);
    if (status === 'failed') expect(result.error?.message).toBe(reply.error_message);
  });
  it('accepts the internal gateway envelope and rejects malformed/business-error submissions', async () => {
    reply = { code: 0, data: { task_uuid: 'wrapped-task' } };
    const request = { taskId: 'task', model: 'doubao/model', input: {} };
    expect((await adapter.submitTask(request)).providerTaskId).toBe('wrapped-task');
    reply = { status: 'pending' }; await expect(adapter.submitTask(request)).rejects.toThrow('missing task_uuid');
    reply = { code: 4001, message: 'not authorized' }; await expect(adapter.submitTask(request)).rejects.toThrow('not authorized');
  });
  it('fails before HTTP without an account and does not invent a cancel endpoint', async () => {
    const missing = new AkoolMaasAdapter({ getResolvedSync: () => ({ baseUrl: 'http://127.0.0.1' }) } as any, { hasPool: () => false } as any);
    await expect(missing.submitTask({ taskId: 'task', model: 'model', input: {} })).rejects.toThrow('no account pool entries');
    expect(requests).toHaveLength(0);
    expect(await adapter.cancelTask()).toMatchObject({ accepted: false });
    expect(adapter.mapStatus('completed')).toBe(TaskStatus.SUCCESS);
  });
  it.each([400, 401, 429, 500])('classifies HTTP %s without discarding provider diagnostics', status => {
    expect(adapter.mapError({ response: { status, data: { error_message: 'supplier diagnostic' } } })).toMatchObject({ message: 'supplier diagnostic', retryable: status === 429 || status >= 500 });
  });
});
