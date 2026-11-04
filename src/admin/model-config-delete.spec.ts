import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ModelConfigService } from './model-config.service';
import { AdminModelConfigController } from './admin-model-config.controller';
import { BulkDeleteModelConfigDto, DeleteModelConfigDto } from './dto/delete-model-config.dto';
import { PERMISSIONS_KEY } from './decorators/require-permissions.decorator';

describe('Model configuration deletion', () => {
  const id = '507f1f77bcf86cd799439011', otherId = '507f1f77bcf86cd799439012';
  let current: any, db: any, routes: any, tasks: any, service: ModelConfigService;
  beforeEach(() => {
    current = { _id: id, model_id: 'tts', provider: 'akool-openapi', revision: 2 };
    db = { findById: jest.fn(() => ({ lean: async () => current })), findOneAndDelete: jest.fn(async () => current) };
    routes = { countDocuments: jest.fn().mockResolvedValue(0) };
    tasks = { countDocuments: jest.fn().mockResolvedValue(0) };
    service = new ModelConfigService(db, routes, tasks);
  });
  it('deletes exactly the selected configuration with an atomic revision filter', async () => {
    expect(await service.deleteConfig(id, 2)).toEqual({ id, model_id: 'tts', deleted: true });
    expect(db.findOneAndDelete).toHaveBeenCalledWith({ _id: id, revision: 2 });
    expect(routes.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ model_id: 'tts', $or: expect.arrayContaining([{ fixed_provider: 'akool-openapi' }]) }));
    expect(tasks.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ model: 'tts', provider: 'akool-openapi', status: { $nin: expect.arrayContaining(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED']) } }));
  });
  it('supports legacy documents with no revision', async () => {
    delete current.revision;
    await service.deleteConfig(id, 0);
    expect(db.findOneAndDelete).toHaveBeenCalledWith({ _id: id, $or: [{ revision: 0 }, { revision: { $exists: false } }] });
  });
  it('rejects invalid IDs, missing configurations and stale revisions before deleting', async () => {
    await expect(service.deleteConfig('invalid', 2)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteConfig(id, 1)).rejects.toBeInstanceOf(ConflictException);
    current = null;
    await expect(service.deleteConfig(id, 2)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.findOneAndDelete).not.toHaveBeenCalled();
  });
  it.each(['routes', 'tasks'])('blocks a configuration referenced by %s', async dependency => {
    (dependency === 'routes' ? routes : tasks).countDocuments.mockResolvedValue(1);
    await expect(service.deleteConfig(id, 2)).rejects.toThrow('请先处理关联数据');
    expect(db.findOneAndDelete).not.toHaveBeenCalled();
  });
  it('reports a concurrent change instead of falsely reporting deletion success', async () => {
    db.findOneAndDelete.mockResolvedValue(null);
    await expect(service.deleteConfig(id, 2)).rejects.toBeInstanceOf(ConflictException);
  });
  it('returns individual results and continues after a failed row', async () => {
    db.findById.mockImplementation((configId: string) => ({ lean: async () => configId === otherId ? null : current }));
    expect(await service.bulkDelete([{ id: otherId, expected_revision: 2 }, { id, expected_revision: 2 }])).toEqual({ results: [
      { id: otherId, status: 'failed', error: '模型配置不存在' }, { id, status: 'success' },
    ] });
    expect(db.findOneAndDelete).toHaveBeenCalledTimes(1);
  });
  it.each([[], Array.from({ length: 101 }, () => ({ id, expected_revision: 2 })), [{ id, expected_revision: 2 }, { id, expected_revision: 2 }], [{ id, expected_revision: -1 }]].map(items => ({ items })))('rejects malformed bulk requests before deleting any row', async ({ items }) => {
    await expect(service.bulkDelete(items)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.findOneAndDelete).not.toHaveBeenCalled();
  });
  it('requires model:delete on both endpoints and delegates validated requests', async () => {
    const controller = new AdminModelConfigController(db, service);
    for (const handler of [controller.remove, controller.bulkDelete]) expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['model:delete']);
    expect(await controller.remove(id, { expected_revision: 2 })).toMatchObject({ code: 0, data: { deleted: true } });
    const result = await controller.bulkDelete({ items: [{ id, expected_revision: 2 }] });
    expect(result.data.results[0].status).toBe('success');
  });
  it('validates nested deletion items through the application validation policy', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: BulkDeleteModelConfigDto };
    await expect(pipe.transform({ items: [{ id, expected_revision: 0 }] }, metadata)).resolves.toMatchObject({ items: [{ id, expected_revision: 0 }] });
    await expect(pipe.transform({ items: [{ id: 'invalid', expected_revision: 0 }] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ items: [{ id, expected_revision: 0, unexpected: true }] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({}, { type: 'body', metatype: DeleteModelConfigDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
