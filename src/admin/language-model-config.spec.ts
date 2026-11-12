import { ModelConfigService } from './model-config.service';
import { languageModelPreset, voiceModelPreset } from './model-config-presets';
import { AdminModelConfigController } from './admin-model-config.controller';
import { estimateModelPrice, estimatePublicModelPrice } from '../common/utils/model-pricing';
import { BillingAdapter } from '../billing/billing.adapter';
import { UsageType } from '../billing/interfaces/billing.interface';

describe('Admin LLM/TTS configuration, publish gate and character billing', () => {
  const service = new ModelConfigService({} as any);
  it.each([languageModelPreset, voiceModelPreset])('allows a disabled, unpriced preset but rejects enabling without verified prices', make => {
    const config = make(); expect(service.validateConfig(config).valid).toBe(true);
    expect(service.validateConfig({ ...config, unit_price_map: undefined }).valid).toBe(true); // Legacy Mongo documents may have minimized {}.
    expect(service.validateConfig({ ...config, disabled: false }).valid).toBe(false);
    expect(service.validateConfig({ ...config, unit_price_map: { default: { unit_credit: 0 } } }).valid).toBe(false);
    expect(service.validateConfig({ ...config, disabled: false, unit_price_map: { default: { unit_credit: 0.01, sale_unit_price: 0.01, cost_unit_price: 0.001 } } }).errors).toEqual([]);
  });
  it('enforces the same price gate through the quick enable action', async () => {
    const db: any = { findOne: () => ({ lean: async () => ({ ...voiceModelPreset(), _id: 'config', revision: 2 }) }), findOneAndUpdate: jest.fn() };
    const controller = new AdminModelConfigController(db, service);
    expect(await controller.toggle({ id: 'config', disabled: false })).toMatchObject({
      code: 1001,
      message: expect.stringContaining('定价'),
      errors: expect.arrayContaining([expect.objectContaining({ field: 'unit_price_map' })]),
    });
    expect(db.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('derives units from Unicode text identically in public and server estimates, ignoring caller counts', () => {
    const config = { ...voiceModelPreset(), unit_price_map: { default: { unit_credit: 0.01 } } };
    const input = { text: '你😀好！', batch_quantity: 9999, max_tokens: 9999 };
    expect(estimateModelPrice(config as any, input)).toMatchObject({ estimatedUsage: 4, estimatedCost: 0.04, usageType: 'count' });
    expect(estimatePublicModelPrice('tts', { ...config.pricing, usage_type: 'count', usage_measure: 'characters', currency: 'credit', tiers: { default: 0.01 } }, input).estimatedCost).toBe(0.04);
    expect(() => estimateModelPrice(config as any, { text: '' })).toThrow('Invalid billing usage');
  });
  it('snapshots trusted character units on reservation and settles them despite mutable input or supplier metadata', async () => {
    const billing: any = { transaction: (work: any) => work(), createRecord: jest.fn(), markPreDeducted: jest.fn(), getRecord: jest.fn(), settle: jest.fn() };
    const wallet: any = { freeze: jest.fn().mockResolvedValue(true), unfreeze: jest.fn(), debit: jest.fn().mockResolvedValue(true) };
    const cfg = { ...voiceModelPreset(), unit_price_map: { default: { unit_credit: 0.01 } } };
    const adapter = new BillingAdapter({ findOne: () => ({ select: () => ({ lean: async () => ({ billingPolicy: 'internal' }) }) }) } as any, {} as any,
      { estimate: async () => estimateModelPrice(cfg as any, { text: '你😀好！' }) } as any, billing, wallet, {} as any);
    await adapter.initBilling({ taskId: 'tts-test', model: cfg.model_id, provider: cfg.provider, apiKey: 'fixture', featureType: 'tts', input: { text: '你😀好！' }, modelConfig: cfg as any });
    expect(billing.createRecord.mock.calls[0][0].usageMeasure).toBe('characters');
    expect(wallet.freeze).toHaveBeenCalledWith('fixture', 0.04, 'tts-test');
    billing.getRecord.mockResolvedValue({ apiKey: 'fixture', unitPrice: 0.01, usageMeasure: 'characters', usageType: 'count', estimatedUsage: 4, estimatedCost: 0.04, status: 'pre_deducted', billingPolicy: 'internal' });
    await adapter.settle({ taskId: 'tts-test', requestInput: { text: 'changed', batch_quantity: 99999 }, rawUsageResult: { duration: 9999, deduction_credit: 99 }, actualUsage: { usageType: UsageType.TOKEN, usageValue: 100000 } });
    expect(billing.settle).toHaveBeenCalledWith('tts-test', 4, 0.04);
    expect(wallet.debit).toHaveBeenCalledWith('fixture', 0.04, 'tts-test');
  });
});
