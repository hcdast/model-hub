import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { WorkflowAssetController } from '../workflow-asset.controller';
import { WorkflowAssetService } from '../workflow-asset.service';
import { ApiKeyOrJwtGuard } from '../../auth/guards/api-key-or-jwt.guard';

describe('Asset upload feature routing over multipart HTTP', () => {
  let app: INestApplication;
  let base: string;
  const assets = { upload: jest.fn().mockResolvedValue({ id: 'asset' }) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkflowAssetController],
      providers: [{ provide: WorkflowAssetService, useValue: assets }],
    }).overrideGuard(ApiKeyOrJwtGuard).useValue({ canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer test-owner') return false;
      req.apiClient = { userId: 'owner' };
      return true;
    } }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => assets.upload.mockClear());

  async function upload(feature?: string, authenticated = true) {
    const body = new FormData();
    body.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    if (feature !== undefined) body.append('feature', feature);
    return fetch(`${base}/v1/workflow-assets`, { method: 'POST', body, headers: authenticated ? { Authorization: 'Bearer test-owner' } : {} });
  }

  it.each([[undefined, 'upload'], ['workflow', 'upload'], ['short-drama', 'drama-upload']])('routes feature %s and keeps existing clients working', async (feature, purpose) => {
    const response = await upload(feature);
    expect(response.status).toBe(201);
    expect(assets.upload).toHaveBeenCalledWith('owner', expect.objectContaining({ buffer: Buffer.from('hello'), mimetype: 'text/plain' }), purpose);
  });

  it.each(['../escape', 'drama-render', 'drama-archive', 'unknown'])('rejects arbitrary or server-only feature %s', async feature => {
    expect((await upload(feature)).status).toBe(400);
    expect(assets.upload).not.toHaveBeenCalled();
  });

  it('requires authentication before accepting an upload', async () => {
    expect((await upload('short-drama', false)).status).toBe(403);
    expect(assets.upload).not.toHaveBeenCalled();
  });
});
