import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminProviderConfigController } from './admin-provider-config.controller';
import { PERMISSIONS_KEY } from './decorators/require-permissions.decorator';

describe('Supplier configuration lifecycle', () => {
  const name = 'akool-maas';
  const req: any = { adminUser: { username: 'admin' }, ip: '127.0.0.1' };
  let row: any, runtime: any, provider: any, audit: any, pool: any, dependencies: any[], controller: AdminProviderConfigController;
  beforeEach(() => {
    row = { _id: 'config-id', provider_name: name, enabled: false, revision: 3 };
    runtime = {
      find: jest.fn(() => ({ lean: async () => row ? [row] : [] })),
      findOne: jest.fn(() => ({ lean: async () => row })),
      findOneAndUpdate: jest.fn(async () => ({ revision: 4 })),
      findOneAndDelete: jest.fn(async () => row),
    };
    provider = { getResolvedSync: () => ({ baseUrl: 'https://example.com', limits: {}, pollLimits: {} }), invalidateAndRefresh: jest.fn() };
    audit = { log: jest.fn() };
    pool = { refreshAllPools: jest.fn() };
    dependencies = Array.from({ length: 4 }, () => ({ countDocuments: jest.fn().mockResolvedValue(0) }));
    controller = new AdminProviderConfigController(runtime, provider, audit, dependencies[0], dependencies[1], dependencies[2], dependencies[3], pool);
  });

  it('lists only configured providers, keeping supported adapters available for adding them again', async () => {
    expect((await controller.list()).data.items.map(i => i.provider_name)).toEqual([name]);
    row = null;
    const result = await controller.list();
    expect(result.data.items).toEqual([]);
    expect(result.data.available_providers).toContain(name);
    await expect(controller.detail(name)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires disabling before deletion and rejects unknown or missing configurations', async () => {
    await expect(controller.remove('unknown-provider', req)).rejects.toBeInstanceOf(BadRequestException);
    row.enabled = true;
    await expect(controller.remove(name, req)).rejects.toThrow('请先停用');
    row = null;
    await expect(controller.remove(name, req)).rejects.toBeInstanceOf(NotFoundException);
    expect(runtime.findOneAndDelete).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2, 3])('blocks deletion when dependency group %s still references it', async index => {
    dependencies[index].countDocuments.mockResolvedValue(2);
    await expect(controller.remove(name, req)).rejects.toThrow('请先处理关联数据');
    expect(runtime.findOneAndDelete).not.toHaveBeenCalled();
    expect(provider.invalidateAndRefresh).not.toHaveBeenCalled();
  });

  it('deletes an unused disabled provider, refreshes runtime state and records an audit event', async () => {
    expect(await controller.remove(name, req)).toMatchObject({ code: 0, data: { deleted: true } });
    expect(runtime.findOneAndDelete).toHaveBeenCalledWith({ _id: row._id, enabled: false, revision: 3 });
    expect(provider.invalidateAndRefresh).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith('provider_runtime_config.delete', 'admin', { provider_name: name, revision: 3 }, req.ip);
    const filter = dependencies[2].countDocuments.mock.calls[0][0];
    expect(filter.$or).toContainEqual({ 'weighted_targets.provider': name });
    expect(filter.$or).toContainEqual({ 'cost_targets.provider': name });
    expect(filter.$or).toContainEqual({ latency_targets: name });
    expect(dependencies[3].countDocuments.mock.calls[0][0].status.$nin).toContain('SUCCESS');
  });

  it('does not delete a supplier that was edited or re-enabled concurrently', async () => {
    runtime.findOneAndDelete.mockResolvedValue(null);
    await expect(controller.remove(name, req)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('validates toggle payloads and preserves other runtime settings on a status change', async () => {
    await expect(controller.upsert(name, { enabled: 'false' } as any, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(runtime.findOneAndUpdate).not.toHaveBeenCalled();
    await controller.upsert(name, { enabled: false }, req);
    expect(runtime.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { enabled: false }, $inc: { revision: 1 } });
    expect(provider.invalidateAndRefresh).toHaveBeenCalled();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.remove)).toEqual(['provider:delete']);
    expect(pool.refreshAllPools).toHaveBeenCalled();
  });
  it('rejects stale form revisions without writing or refreshing provider state', async () => {
    await expect(controller.upsert(name, { expected_revision: 2, llm_base_url: 'https://llm-fat.akool.io/v1' }, req)).rejects.toBeInstanceOf(ConflictException);
    expect(runtime.findOneAndUpdate).not.toHaveBeenCalled();
    expect(provider.invalidateAndRefresh).not.toHaveBeenCalled();
    await controller.upsert(name, { expected_revision: 3, llm_base_url: 'https://llm-fat.akool.io/v1' }, req);
    expect(runtime.findOneAndUpdate).toHaveBeenCalledWith({ provider_name: name, revision: 3 }, expect.objectContaining({ $set: { 'extra.llm_base_url': 'https://llm-fat.akool.io/v1' } }), expect.any(Object));
  });
  it('updates the LLM endpoint without replacing unrelated extra settings', async () => {
    await controller.upsert(name, { llm_base_url: 'https://llm-fat.akool.io/v1/' }, req);
    expect(runtime.findOneAndUpdate.mock.calls[0][1].$set).toEqual({ 'extra.llm_base_url': 'https://llm-fat.akool.io/v1' });
    for (const base of ['https://llm-fat.akool.io', 'http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?token=secret', 'https://example.com/api']) {
      runtime.findOneAndUpdate.mockClear();
      await expect(controller.upsert(name, { llm_base_url: base }, req)).rejects.toBeInstanceOf(BadRequestException);
      expect(runtime.findOneAndUpdate).not.toHaveBeenCalled();
    }
    await expect(controller.upsert(name, { llm_base_url: '', extra: {} }, req)).rejects.toBeInstanceOf(BadRequestException);
  });
});
