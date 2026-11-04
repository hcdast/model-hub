import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AkoolOpenapiAdapter } from './akool-openapi.adapter';

describe('VoiceLab v4 HTTP contract and account affinity (no supplier calls)', () => {
  let server: Server, adapter: AkoolOpenapiAdapter, requests: any[], resultStatus: number, replyCode: number, enabled: boolean;
  let accounts: any[];
  let failures: { path: string; statuses: number[] } | undefined;
  const voice = { _id: 'voice-doc', voice_id: 'official-voice', name: '清晰旁白', status: 3, voice_model_name: 'Akool Multilingual 3', locale: 'zh', language: 'Chinese', preview: 'https://media.example/sample.mp3' };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        requests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined });
        if (failures && req.url?.startsWith(failures.path) && failures.statuses.length) {
          res.writeHead(failures.statuses.shift()!, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ secret: 'supplier-secret-payload' })); return;
        }
        const data = req.url?.startsWith('/api/open/v4/voice/list') ? { result: [voice, { ...voice, voice_model_name: 'Akool Multilingual 1' }], count: 21 }
          : req.url?.startsWith('/api/open/v4/voice/detail/') ? voice : req.method === 'POST' ? { _id: 'resource-doc', status: 1 }
            : { result: { status: resultStatus, preview: 'https://media.example/output.mp3', duration: 5500 } };
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: replyCode, data }));
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adapter = new AkoolOpenapiAdapter({ getResolvedSync: () => ({ baseUrl, enabled }), getSubmitLimitsSync: () => ({ maxConcurrent: 2, maxPerSecond: 1 }) } as any,
      { hasPool: () => true, getActiveAccounts: () => accounts, selectAccount: async () => accounts[1], reportResult: async () => {} } as any);
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
  beforeEach(() => { requests = []; failures = undefined; resultStatus = 3; replyCode = 1000; enabled = true; accounts = [{ _id: 'account-a', api_key: 'fixture-key-a' }, { _id: 'account-b', api_key: 'fixture-key-b' }]; });
  async function input() { const list = await adapter.voices(); return { text: '你好，世界！', voice_id: list.items[0].id, voice_model_name: 'Akool Multilingual 3', speed: 1.1, volume: 60, emotion: 'happy', language_code: 'zh' }; }
  it('lists only compatible ready voices without exposing keys and submits documented fields using the same account', async () => {
    const i = await input(); const submitted = await adapter.submitTask({ taskId: 'test', model: 'tts', input: i });
    const post = requests.find(r => r.method === 'POST');
    expect(post.body).toEqual({ input_text: i.text, voice_id: 'official-voice', voice_options: { speed: 1.1, volume: 60, emotion: 'happy' }, language_code: 'zh' });
    expect(requests[0].url).toBe('/api/open/v4/voice/list?type=2&page=1&size=20');
    expect(requests.every(r => r.headers['x-api-key'] === 'fixture-key-a' && !r.headers.authorization)).toBe(true);
    expect(submitted.isSync).toBe(false); expect(JSON.stringify(submitted)).not.toContain('fixture-key');
    accounts.reverse(); // Pool order changes must not switch the resource owner.
    expect(await adapter.queryTask(submitted.providerTaskId)).toEqual({ status: 'succeeded', result: { audio: 'https://media.example/output.mp3', duration: 5.5 } });
    expect(requests.at(-1).headers['x-api-key']).toBe('fixture-key-a');
    expect(requests.at(-1).url).toBe('/api/open/v4/voice/resource/detail/resource-doc');
  });
  it.each([[1, 'pending'], [2, 'processing'], [3, 'succeeded'], [4, 'failed'], [999, 'unknown']])('maps upstream state %s', async (state, expected) => {
    const submitted = await adapter.submitTask({ taskId: 'test', model: 'tts', input: await input() });
    resultStatus = state as number; expect((await adapter.queryTask(submitted.providerTaskId)).status).toBe(expected);
  });
  it('normalizes the account /api base override for catalog, submission and polling', async () => {
    accounts[0].base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
    const submitted = await adapter.submitTask({ taskId: 'base-prefix', model: 'tts', input: await input() });
    expect((await adapter.queryTask(submitted.providerTaskId)).status).toBe('succeeded');
    expect(requests.every(r => r.url.startsWith('/api/open/v4/') && !r.url.includes('/api/api/'))).toBe(true);
    accounts[0].base_url += 'open/v4/voice';
    await expect(adapter.voices()).rejects.toThrow('不要填写具体接口路径');
  });
  it('refuses lost owner credentials and disabled suppliers before another generation POST', async () => {
    const i = await input(); accounts = accounts.filter(a => a._id !== 'account-a');
    await expect(adapter.submitTask({ taskId: 'test', model: 'tts', input: i })).rejects.toThrow('原账号');
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    enabled = false; await expect(adapter.voices()).rejects.toThrow('尚未启用');
  });
  it('validates input and supplier envelopes and does not forward arbitrary parameters', async () => {
    const i = await input();
    for (const patch of [{ voice_id: 'arbitrary-id' }, { speed: 2 }, { text: '' }, { volume: 100.1 }, { emotion: 'unknown' }]) await expect(adapter.submitTask({ taskId: 't', model: 'tts', input: { ...i, ...patch } })).rejects.toThrow();
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    replyCode = 1003; await expect(adapter.voices()).rejects.toThrow('业务码 1003');
  });
  it('retries transient reads but never automatically repeats an ambiguous paid POST', () => {
    for (const method of ['post', 'get']) expect(adapter.mapError({ response: { status: 503 }, config: { method } }).retryable).toBe(method === 'get');
    expect(adapter.mapError({ code: 'ECONNABORTED', config: { method: 'post' } }).retryable).toBe(false);
    expect(adapter.mapError({ code: 'ECONNRESET', config: { method: 'get' } }).retryable).toBe(true);
    expect(adapter.mapError({ response: { status: 401, data: { key: 'secret' } } }).message).not.toContain('secret');
    expect(adapter.supportsCancellation).toBe(false);
  });
  it('recovers one transient metadata failure using the same account without any paid POST', async () => {
    const i = await input();
    failures = { path: '/api/open/v4/voice/detail/', statuses: [502] };
    await expect(adapter.validateVoice(i)).resolves.toEqual({ accountId: 'account-a', voiceId: 'official-voice' });
    const reads = requests.filter(r => r.url.startsWith(failures!.path));
    expect(reads).toHaveLength(2);
    expect(reads.every(r => r.headers['x-api-key'] === 'fixture-key-a')).toBe(true);
    expect(requests.some(r => r.method === 'POST')).toBe(false);
  });
  it.each([401, 502])('bounds HTTP %s metadata failures and sanitizes the error', async status => {
    failures = { path: '/api/open/v4/voice/list', statuses: [status, status, status] };
    const failure = await adapter.voices().catch(e => e);
    expect(failure).toBeInstanceOf(Error);
    expect(requests).toHaveLength(status === 401 ? 1 : 2);
    expect(JSON.stringify(failure) + failure.message).not.toMatch(/fixture-key|supplier-secret-payload|x-api-key/);
    if (status === 502) {
      expect(failure.message).toContain('尚未提交配音生成');
      expect(adapter.mapError(failure).retryable).toBe(true);
    }
  });
  it('does not retry an actual failed paid POST', async () => {
    const i = await input();
    failures = { path: '/api/open/v4/voice/tts', statuses: [502] };
    await expect(adapter.submitTask({ taskId: 'ambiguous', model: 'tts', input: i })).rejects.toMatchObject({ response: { status: 502 } });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
  });
});
