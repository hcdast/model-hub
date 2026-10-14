import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo, Socket } from 'net';
import { AppConfig, WorkflowAssetMinioConfig } from '../../config/interfaces/config.interface';
import { MinioWorkflowAssetStorageService } from '../minio-workflow-asset-storage.service';

const accessName = 'WORKFLOW_ASSET_MINIO_ACCESS_KEY_ID';
const secretName = 'WORKFLOW_ASSET_MINIO_SECRET_ACCESS_KEY';
const ownerKey = createHash('sha256').update('private-owner').digest('hex');
const context = () => ({ assetId: randomUUID(), ownerKey, fileExt: 'txt', contentType: 'text/plain' });
const valid: WorkflowAssetMinioConfig = {
  endPoint: '127.0.0.1', port: 9000, useSSL: false, bucket: 'modelhub', region: 'us-east-1',
  publicBaseUrl: 'https://cdn.example.com/modelhub/', allowInsecureHttp: true, uploadTimeoutMs: 1000,
};
const create = (minio: unknown = valid) => new MinioWorkflowAssetStorageService({ workflowAssetStorage: { provider: 'minio', minio } } as AppConfig);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('MinioWorkflowAssetStorageService configuration', () => {
  const saved = [process.env[accessName], process.env[secretName]];
  beforeEach(() => { process.env[accessName] = 'test-access-key'; process.env[secretName] = 'test-secret-key'; });
  afterAll(() => {
    [accessName, secretName].forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    });
  });

  it('does not require MinIO configuration or secrets for the legacy provider', () => {
    delete process.env[accessName]; delete process.env[secretName];
    expect(new MinioWorkflowAssetStorageService({} as AppConfig).enabled).toBe(false);
    expect(new MinioWorkflowAssetStorageService({ workflowAssetStorage: { provider: 'storagesvc', minio: null } } as unknown as AppConfig).enabled).toBe(false);
  });
  it.each([null, {}, { provider: 'unknown' }])('rejects explicit invalid providers: %j', value => {
    expect(() => new MinioWorkflowAssetStorageService({ workflowAssetStorage: value } as AppConfig)).toThrow('workflowAssetStorage.provider');
  });
  it('requires configuration and nonblank credentials only when enabled', () => {
    expect(() => create(null)).toThrow('workflowAssetStorage.minio');
    expect(create().enabled).toBe(true);
    for (const name of [accessName, secretName]) {
      const previous = process.env[name]; process.env[name] = '  ';
      expect(() => create()).toThrow('workflowAssetStorage.minio.credentials');
      process.env[name] = previous;
    }
  });
  it.each([
    ['endPoint', 'http://secret.example.com'], ['endPoint', 'host:9000'], ['endPoint', 'a/path'], ['endPoint', ''],
    ['port', '9000'], ['port', 0], ['port', 65536], ['port', 1.5], ['useSSL', 'false'],
    ['bucket', 'UPPER'], ['bucket', 'ab'], ['bucket', 'a..b'], ['bucket', '127.0.0.1'],
    ['region', ''], ['region', 'with space'], ['pathPrefix', '../private'], ['pathPrefix', 'a//b'],
    ['pathPrefix', '/assets'], ['pathPrefix', 'a\\b'], ['pathPrefix', 'a/%2f'], ['pathPrefix', ''],
    ['uploadTimeoutMs', 999], ['uploadTimeoutMs', 300001], ['uploadTimeoutMs', '1000'],
    ['uploadTimeoutMs', null], ['pathPrefix', null],
    ['publicBaseUrl', 'https://localhost/'], ['publicBaseUrl', 'https://127.0.0.1/'],
    ['publicBaseUrl', 'https://192.168.1.1/'], ['publicBaseUrl', 'https://host.local/'],
    ['publicBaseUrl', 'ftp://secret.example.com'], ['publicBaseUrl', 'https://user:secret@example.com'],
    ['publicBaseUrl', 'https://example.com/?token=secret'], ['publicBaseUrl', 'https://example.com/#secret'],
    ['publicBaseUrl', 'https://example.com/%2e%2e/private'], ['publicBaseUrl', 'https://example.com/a%2fb'],
    ['publicBaseUrl', 'https://example.com/a\\b'], ['allowInsecureHttp', 'true'],
  ])('rejects invalid %s without echoing its value', (field, value) => {
    expect(() => create({ ...valid, [field]: value })).toThrow(`workflowAssetStorage.minio.${field}`);
  });
  it('requires explicit HTTP permission for upload and public reads independently', () => {
    expect(() => create({ ...valid, allowInsecureHttp: undefined })).toThrow('allowInsecureHttp');
    expect(() => create({ ...valid, useSSL: true, publicBaseUrl: 'http://cdn.example.com', allowInsecureHttp: false })).toThrow('allowInsecureHttp');
    expect(create({ ...valid, useSSL: true, allowInsecureHttp: undefined }).enabled).toBe(true);
  });
});

describe('MinioWorkflowAssetStorageService real SDK transport', () => {
  let server: Server;
  let sockets: Set<Socket>;
  let port: number;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  let logError: jest.SpyInstance;
  const saved = [process.env[accessName], process.env[secretName]];
  beforeEach(async () => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env[accessName] = 'test-access-key'; process.env[secretName] = 'test-secret-key';
    sockets = new Set();
    handler = (_req, res) => { res.writeHead(200, { ETag: '"etag"' }); res.end(); };
    server = createServer((req, res) => handler(req, res));
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    logError.mockRestore();
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  afterAll(() => {
    [accessName, secretName].forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    });
  });

  it('writes exact bytes, length and MIME with isolated hashed keys and stable URLs', async () => {
    const requests: { method?: string; path?: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requests.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(200, { ETag: '"etag"' }); res.end();
      });
    };
    const service = create({ ...valid, port, pathPrefix: 'workflow-assets/nested', publicBaseUrl: 'https://cdn.example.com/素材///' });
    const body = Buffer.from('你好\u0000\xff');
    const first = context();
    const second = { ...context(), ownerKey: createHash('sha256').update('second-owner').digest('hex') };
    const urls = await Promise.all([service.upload(body, first), service.upload(body, second)]);
    expect(new Set(urls).size).toBe(2);
    for (const [index, item] of [first, second].entries()) {
      const key = `workflow-assets/nested/${item.ownerKey}/${item.assetId}.txt`;
      expect(urls[index]).toBe(`https://cdn.example.com/%E7%B4%A0%E6%9D%90/${key}`);
      const request = requests.find(value => value.path === `/modelhub/${key}`)!;
      expect(request.method).toBe('PUT');
      expect(request.headers['content-length']).toBe(String(body.length));
      expect(request.headers['content-type']).toBe('text/plain');
      expect(request.body).toEqual(body);
      expect(request.path).not.toContain('private-owner');
    }
    expect(requests).toHaveLength(2);
    service.logMetadataFailure(first);
    expect(logError.mock.calls).toEqual([[{
      category: 'metadata_failure', assetId: first.assetId,
      objectKey: `workflow-assets/nested/${first.ownerKey}/${first.assetId}.txt`,
    }]]);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private-owner|test-secret-key|test-access-key|Authorization/);
  });

  it('discovers region only when omitted and writes without bucket mutation', async () => {
    const methods: string[] = [];
    handler = (req, res) => {
      methods.push(`${req.method} ${req.url}`);
      if (req.method === 'GET') res.end('<LocationConstraint>eu-west-1</LocationConstraint>');
      else { res.writeHead(200, { ETag: '"etag"' }); res.end(); }
    };
    await create({ ...valid, port, region: undefined }).upload(Buffer.from('hello'), context());
    expect(methods).toHaveLength(2);
    expect(methods[0]).toBe('GET /modelhub?location');
    expect(methods[1]).toMatch(/^PUT \/modelhub\/workflow-assets\//);
  });

  it.each([403, 404, 503])('sanitizes HTTP %i and does not retry or write/delete other objects', async status => {
    let calls = 0;
    handler = (_req, res) => {
      calls++;
      res.writeHead(status, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>AccessDenied</Code><Message>test-secret-key test-access-key Authorization secret-token</Message></Error>');
    };
    const item = context();
    const failure = await create({ ...valid, port }).upload(Buffer.from('hello'), item).catch(error => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getStatus()).toBe(503);
    expect(JSON.stringify(failure)).not.toMatch(/test-secret-key|test-access-key|secret-token|Authorization/);
    expect(failure.message).toBe('Workflow asset storage unavailable');
    expect(logError.mock.calls).toEqual([[{ category: 'storage_failure', assetId: item.assetId }]]);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/test-secret-key|test-access-key|secret-token|Authorization/);
    await sleep(1100);
    expect(calls).toBe(1);
  });

  it('aborts a stalled response while a concurrent upload on the same client succeeds', async () => {
    const slow = context();
    let closed!: () => void;
    let received!: () => void;
    const responseClosed = new Promise<void>(resolve => { closed = resolve; });
    const responseReceived = new Promise<void>(resolve => { received = resolve; });
    let calls = 0;
    handler = (req, res) => {
      calls++;
      req.resume();
      if (req.url!.includes(slow.assetId)) {
        res.writeHead(200, { ETag: '"etag"' }); res.write('unfinished');
        res.on('close', closed); received();
      } else { res.writeHead(200, { ETag: '"etag"' }); res.end(); }
    };
    const service = create({ ...valid, port });
    const failure = service.upload(Buffer.from('slow'), slow).catch(error => error);
    await responseReceived;
    await expect(service.upload(Buffer.from('fast'), context())).resolves.toMatch(/^https:\/\//);
    expect(await failure).toBeInstanceOf(ServiceUnavailableException);
    expect(logError.mock.calls).toEqual([[{ category: 'timeout', assetId: slow.assetId }]]);
    await responseClosed;
    await sleep(100);
    expect(calls).toBe(2);
  });

  it('aborts stalled region discovery without sending a PUT after deadline', async () => {
    let calls = 0;
    let closed!: () => void;
    const socketClosed = new Promise<void>(resolve => { closed = resolve; });
    handler = (req, _res) => { calls++; req.socket.once('close', closed); };
    const item = context();
    const failure = await create({ ...valid, port, region: undefined }).upload(Buffer.from('hello'), item).catch(error => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.message).toBe('Workflow asset storage unavailable');
    expect(logError.mock.calls).toEqual([[{ category: 'timeout', assetId: item.assetId }]]);
    await socketClosed;
    await sleep(100);
    expect(calls).toBe(1);
  });

  it('rejects unsafe keys before any request', async () => {
    let calls = 0;
    handler = (_req, res) => { calls++; res.end(); };
    const service = create({ ...valid, port });
    for (const patch of [{ assetId: '../escape' }, { ownerKey: 'raw-owner' }, { fileExt: '../txt' }, { contentType: 'text/plain\r\nsecret' }]) {
      await expect(service.upload(Buffer.from('hello'), { ...context(), ...patch })).rejects.toBeInstanceOf(ServiceUnavailableException);
      if (!('contentType' in patch)) service.logMetadataFailure({ ...context(), ...patch });
    }
    expect(calls).toBe(0);
    expect(logError).not.toHaveBeenCalled();
  });
});
