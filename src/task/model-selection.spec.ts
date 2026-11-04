import { findExplicitModelConfig } from './model-config-resolver.util';

describe('Explicit model selection', () => {
  const id = '507f1f77bcf86cd799439011';
  const cfg = { model_id: 'shared/model', model_type: 'referenceToVideo', provider: 'selected-provider', revision: 3 };
  const lean = jest.fn(); const db: any = { findOne: jest.fn(() => ({ lean })) };
  beforeEach(() => { jest.clearAllMocks(); lean.mockResolvedValue(cfg); });
  it('selects the exact model/capability and configuration instead of first same-name provider', async () => {
    expect(await findExplicitModelConfig(db, cfg.model_id, { configId: id, configRevision: 3 }, cfg.model_type)).toBe(cfg);
    expect(db.findOne).toHaveBeenCalledWith({ _id: id, model_id: cfg.model_id, model_type: cfg.model_type });
  });
  it('rejects invalid IDs, stale revisions, route conflicts and missing configs', async () => {
    await expect(findExplicitModelConfig(db, cfg.model_id, { configId: 'invalid' })).rejects.toThrow('Invalid configId');
    await expect(findExplicitModelConfig(db, cfg.model_id, { configId: id, configRevision: 2 })).rejects.toThrow('模型配置已更新');
    await expect(findExplicitModelConfig(db, cfg.model_id, { configId: id }, undefined, 'other-provider')).rejects.toThrow('路由规则');
    lean.mockResolvedValue(null);
    await expect(findExplicitModelConfig(db, cfg.model_id, { configId: id })).rejects.toThrow('不存在');
  });
});
