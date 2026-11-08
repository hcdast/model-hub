import { ArgumentsHost, BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { WorkflowAssetService, validateAssetFile, WORKFLOW_ASSET_MAX_BYTES, WORKFLOW_ASSET_TEXT_MAX_BYTES } from '../workflow-asset.service';
import { createLinkConversionStorageAdapter } from '../../link-conversion/adapters/akool-storagesvc.adapter';
import { createHash } from 'crypto';
import { S3WorkflowAssetStorageService } from '../s3-workflow-asset-storage.service';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';

jest.mock('../../link-conversion/adapters/akool-storagesvc.adapter', () => ({ createLinkConversionStorageAdapter: jest.fn() }));

describe('WorkflowAssetService', () => {
  const ownerId = 'owner-a';
  let assets: any;
  let runs: any;
  let config: any;
  let minioStorage: { enabled: boolean; upload: jest.Mock; logMetadataFailure: jest.Mock };
  let service: WorkflowAssetService;
  let stored: any[];
  let upload: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    stored = [];
    assets = {
      create: jest.fn(async value => { stored.push(value); return value; }),
      deleteOne: jest.fn(filter => ({ exec: async () => ({ deletedCount: stored.findIndex(item => item.id === filter.id && item.ownerId === filter.ownerId) >= 0 ? 1 : 0 }) })),
      find: jest.fn(filter => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: () => ({ exec: async () => stored.filter(item => item.ownerId === filter.ownerId) }) }) }) }) })),
      countDocuments: jest.fn(filter => ({ exec: async () => stored.filter(item => item.ownerId === filter.ownerId).length })),
    };
    runs = { findOne: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })) };
    config = { getEffectiveConfig: jest.fn().mockResolvedValue({ storagesvc: { host: 'https://storage.example.com', jwt_secret: 'test' }, storage_config: { bucket: 'assets' }, timeout: { upload_ms: 1000 } }) };
    upload = jest.fn().mockResolvedValue('https://cdn.example.com/asset.txt');
    (createLinkConversionStorageAdapter as jest.Mock).mockReturnValue({ upload });
    minioStorage = { enabled: false, upload: jest.fn().mockResolvedValue('https://minio.example.com/workflow-assets/asset.txt'), logMetadataFailure: jest.fn() };
    // The in-process double only implements the storage API consumed by WorkflowAssetService.
    const storageService = minioStorage as unknown as S3WorkflowAssetStorageService;
    service = new WorkflowAssetService(assets, runs, config, storageService);
  });

  it('uploads validated text to existing storage without leaking ownerId', async () => {
    const result = await service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: '../../hello.txt' });
    expect(result).toMatchObject({ text: 'hello', kind: 'text', url: 'https://cdn.example.com/asset.txt' });
    expect(result).not.toHaveProperty('ownerId');
    expect(stored[0].ownerId).toBe(ownerId);
    expect(stored[0].name).not.toMatch(/[\\/]/);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(config.getEffectiveConfig).toHaveBeenCalledTimes(1);
    expect(minioStorage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['text/plain', '你好，素材', 'txt'],
    ['application/json', '{"answer":42}', 'json'],
  ])('uploads %s through MinIO without reading legacy config and preserves its body', async (mimeType, text, fileExt) => {
    minioStorage.enabled = true;
    config.getEffectiveConfig.mockRejectedValue(new Error('legacy host missing'));
    const buffer = Buffer.from(text);
    const result = await service.upload(ownerId, { buffer, mimetype: mimeType, originalname: '../../input.txt' });
    expect(minioStorage.upload).toHaveBeenCalledWith(buffer, {
      assetId: result.id,
      ownerKey: createHash('sha256').update(ownerId).digest('hex'),
      fileExt,
      contentType: mimeType,
      purpose: 'upload',
    });
    expect(result).toMatchObject({ text, mimeType, kind: 'text', url: 'https://minio.example.com/workflow-assets/asset.txt', source: 'upload', size: buffer.length });
    expect(result).not.toHaveProperty('ownerId');
    expect(stored[0]).toMatchObject({ id: result.id, ownerId, text, url: result.url });
    expect(config.getEffectiveConfig).not.toHaveBeenCalled();
    expect(createLinkConversionStorageAdapter).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([false, true])('validates files before accessing either backend (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    await expect(service.upload(ownerId, { buffer: Buffer.from('not PNG'), mimetype: 'image/png', originalname: 'x.png' })).rejects.toBeInstanceOf(BadRequestException);
    expect(config.getEffectiveConfig).not.toHaveBeenCalled();
    expect(minioStorage.upload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(assets.create).not.toHaveBeenCalled();
  });

  it('propagates MinIO upload failure without fallback or persistence', async () => {
    minioStorage.enabled = true;
    const failure = new ServiceUnavailableException('素材 MinIO 上传失败');
    minioStorage.upload.mockRejectedValue(failure);
    await expect(service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: 'x.txt' })).rejects.toBe(failure);
    expect(config.getEffectiveConfig).not.toHaveBeenCalled();
    expect(createLinkConversionStorageAdapter).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(assets.create).not.toHaveBeenCalled();
    expect(minioStorage.logMetadataFailure).not.toHaveBeenCalled();
  });

  it('preserves the legacy adapter error response without persistence', async () => {
    upload.mockRejectedValue(new Error('private adapter error'));
    await expect(service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: 'x.txt' })).rejects.toThrow('素材存储上传失败，请管理员检查现有存储服务配置和连通性');
    expect(minioStorage.upload).not.toHaveBeenCalled();
    expect(assets.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('sanitizes metadata failures through the global exception logger (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    const failure = Object.assign(new Error('mongodb://private-user:database-secret@private-host Authorization token'), {
      cause: new Error('database-cause-secret'),
      response: { status: 500, statusText: 'database-status-secret', data: 'database-response-secret' },
      config: { url: 'mongodb://database-config-secret', method: 'connect' },
    });
    failure.stack = 'database-stack-secret';
    assets.create.mockRejectedValue(failure);
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // Exercise the real diagnostic method without constructing an SDK client or reading credentials.
    const diagnostics = Object.assign(Object.create(S3WorkflowAssetStorageService.prototype), {
      config: { pathPrefix: 'workflow-assets' },
      logger: new Logger(S3WorkflowAssetStorageService.name),
    });
    minioStorage.logMetadataFailure.mockImplementation(context => diagnostics.logMetadataFailure(context));
    try {
      const caught = await service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: 'x.txt' }).catch(error => error);
      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect(caught).not.toBe(failure);
      expect(caught.cause).toBeUndefined();
      const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const host = { switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ path: '/portal/workflow-assets/upload', url: '/portal/workflow-assets/upload', method: 'POST' }),
      }) } as unknown as ArgumentsHost;
      new GlobalExceptionFilter().catch(caught, host);
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, message: '素材元数据保存失败，请稍后重试' }));
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('HTTP 503 exception caught'), expect.any(String));
      expect(JSON.stringify([response.json.mock.calls, loggerError.mock.calls, caught.stack, caught.getResponse(), caught])).not.toMatch(/database-(?:secret|stack-secret|cause-secret|status-secret|response-secret|config-secret)|private-user|private-host|Authorization/);
      expect(enabled ? minioStorage.upload : upload).toHaveBeenCalledTimes(1);
      if (enabled) {
        const assetId = assets.create.mock.calls[0][0].id;
        const ownerKey = createHash('sha256').update(ownerId).digest('hex');
        expect(minioStorage.logMetadataFailure).toHaveBeenCalledWith({ assetId, ownerKey, fileExt: 'txt', contentType: 'text/plain', purpose: 'upload' });
        expect(loggerError).toHaveBeenCalledWith({ category: 'metadata_failure', assetId, objectKey: `modelhub/workflow/uploads/text/${ownerKey}/${assetId}.txt` });
        expect(config.getEffectiveConfig).not.toHaveBeenCalled();
      } else {
        expect(minioStorage.logMetadataFailure).not.toHaveBeenCalled();
      }
      expect(stored).toEqual([]);
      expect(assets.deleteOne).not.toHaveBeenCalled();
      expect(enabled ? upload : minioStorage.upload).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it.each([false, true])('lists only current owner assets and hides foreign deletes with 404 (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    const legacyUrl = 'https://cdn.example.com/workflow-assets/old-owner/old-file.txt';
    stored.push({ id: 'foreign', ownerId: 'owner-b' }, { id: 'mine', ownerId, name: 'Mine', url: legacyUrl });
    const result = await service.list(ownerId, 1, 20);
    expect(result.total).toBe(1);
    expect(result.items.map(item => item.id)).toEqual(['mine']);
    expect(result.items[0].url).toBe(legacyUrl);
    await expect(service.delete(ownerId, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.delete(ownerId, 'mine')).toEqual({ id: 'mine', storageObjectDeleted: false });
    expect(minioStorage.upload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('cannot save another owner run output', async () => {
    const input = { workflowId: 'workflow-b', runId: 'run-b', nodeId: 'node-b' };
    await expect(service.fromOutput(ownerId, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(runs.findOne).toHaveBeenCalledWith({ runId: input.runId, workflowId: input.workflowId, triggerId: ownerId });
    expect(assets.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('saves media by reference without fetching URLs or uploading again (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    runs.findOne.mockReturnValue({ lean: () => ({ exec: async () => ({ nodeStates: [{ nodeId: 'n', status: 'succeeded', output: { image: 'https://cdn.example.com/real.png' } }] }) }) });
    expect(await service.fromOutput(ownerId, { workflowId: 'w', runId: 'r', nodeId: 'n' })).toMatchObject({ kind: 'image', url: 'https://cdn.example.com/real.png', source: 'output-reference' });
    expect(upload).not.toHaveBeenCalled();
    expect(minioStorage.upload).not.toHaveBeenCalled();
    expect(config.getEffectiveConfig).not.toHaveBeenCalled();
  });

  it.each([false, true])('saves JSON output through selected storage (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    runs.findOne.mockReturnValue({ lean: () => ({ exec: async () => ({ nodeStates: [{ nodeId: 'n', status: 'succeeded', output: { result: { answer: 42 } } }] }) }) });
    const result = await service.fromOutput(ownerId, { workflowId: 'w', runId: 'r', nodeId: 'n' });
    expect(JSON.parse(result.text!)).toEqual({ answer: 42 });
    expect(result.mimeType).toBe('application/json');
    expect(result).toMatchObject({ source: 'output-text', workflowId: 'w', runId: 'r', nodeId: 'n' });
    expect(enabled ? minioStorage.upload : upload).toHaveBeenCalledTimes(1);
    expect(enabled ? upload : minioStorage.upload).not.toHaveBeenCalled();
    if (enabled) expect(config.getEffectiveConfig).not.toHaveBeenCalled();
  });

  it('preserves text output verbatim through MinIO', async () => {
    minioStorage.enabled = true;
    const text = '第一行\n第二行';
    runs.findOne.mockReturnValue({ lean: () => ({ exec: async () => ({ nodeStates: [{ nodeId: 'n', status: 'succeeded', output: { text } }] }) }) });
    const result = await service.fromOutput(ownerId, { workflowId: 'w', runId: 'r', nodeId: 'n' });
    expect(result).toMatchObject({ text, mimeType: 'text/plain', source: 'output-text', url: 'https://minio.example.com/workflow-assets/asset.txt' });
    expect(minioStorage.upload.mock.calls[0][0]).toEqual(Buffer.from(text));
    expect(minioStorage.upload.mock.calls[0][1].purpose).toBe('output-text');
    expect(config.getEffectiveConfig).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['drama-upload', 'drama-archive', 'drama-render'] as const)('routes %s explicitly and persists its source', async source => {
    minioStorage.enabled = true;
    const buffer = Buffer.from('0000ftypisom');
    const result = await service.upload(ownerId, { buffer, mimetype: 'video/mp4', originalname: 'movie.mp4' }, source);
    expect(minioStorage.upload).toHaveBeenCalledWith(buffer, expect.objectContaining({ purpose: source, contentType: 'video/mp4' }));
    expect(result.source).toBe(source);
    expect(stored[0].source).toBe(source);
  });

  it('fails explicitly without storage config', async () => {
    config.getEffectiveConfig.mockResolvedValue({ storagesvc: {}, storage_config: {} });
    await expect(service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: 'x.txt' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(assets.create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not persist local storage URLs (MinIO %s)', async enabled => {
    minioStorage.enabled = enabled;
    (enabled ? minioStorage.upload : upload).mockResolvedValue('http://127.0.0.1/file');
    await expect(service.upload(ownerId, { buffer: Buffer.from('hello'), mimetype: 'text/plain', originalname: 'x.txt' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(assets.create).not.toHaveBeenCalled();
  });
});

describe('asset upload boundary', () => {
  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])('rejects disallowed type %s', mime => {
    expect(() => validateAssetFile(Buffer.from('<svg/>'), mime)).toThrow(BadRequestException);
  });
  it('rejects spoofed signatures, empty/oversized files and invalid JSON/UTF-8', () => {
    expect(() => validateAssetFile(Buffer.from('not PNG'), 'image/png')).toThrow(BadRequestException);
    expect(() => validateAssetFile(Buffer.alloc(0), 'text/plain')).toThrow(BadRequestException);
    expect(() => validateAssetFile(Buffer.alloc(WORKFLOW_ASSET_MAX_BYTES + 1), 'image/png')).toThrow(BadRequestException);
    expect(() => validateAssetFile(Buffer.alloc(WORKFLOW_ASSET_TEXT_MAX_BYTES + 1), 'text/plain')).toThrow(BadRequestException);
    expect(() => validateAssetFile(Buffer.from('{'), 'application/json')).toThrow(BadRequestException);
    expect(() => validateAssetFile(Buffer.from([0xff]), 'text/plain')).toThrow(BadRequestException);
  });
  it('accepts UTF-8 JSON and recognized PNG signatures', () => {
    expect(validateAssetFile(Buffer.from('{"ok":true}'), 'application/json')).toBe('{"ok":true}');
    expect(() => validateAssetFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).not.toThrow();
  });
});
