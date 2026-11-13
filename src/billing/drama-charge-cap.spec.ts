import { BillingAdapter } from './billing.adapter';
import { UsageType } from './interfaces/billing.interface';

describe('Actual usage settlement and legacy server-authorized charge ceilings', () => {
  const client: any = { findOne: () => ({ select: () => ({ lean: async () => ({ billingPolicy: 'internal' }) }) }) };
  const pricing: any = { estimate: jest.fn() };
  const billing: any = { transaction: (work: any) => work(), createRecord: jest.fn(), getRecord: jest.fn(), settle: jest.fn(), markPreDeducted: jest.fn() };
  const wallet: any = { freeze: jest.fn(), unfreeze: jest.fn(), debit: jest.fn() };
  const adapter = new BillingAdapter(client, {} as any, pricing, billing, wallet, {} as any);
  beforeEach(() => { jest.clearAllMocks(); billing.getRecord.mockResolvedValue(null); wallet.freeze.mockResolvedValue(true); wallet.debit.mockResolvedValue(true); });
  it('rejects price drift before creating a record or freezing any funds', async () => {
    pricing.estimate.mockResolvedValue({ estimatedCost: 3, usageType: UsageType.COUNT });
    await expect(adapter.initBilling({ taskId: 't', apiKey: 'test', model: 'm', provider: 'test', featureType: 'textToImage', input: {}, maxCharge: 2 })).rejects.toThrow('authorized');
    expect(billing.createRecord).not.toHaveBeenCalled(); expect(wallet.freeze).not.toHaveBeenCalled();
  });
  it('caps wallet debit and the settled record while retaining actual usage', async () => {
    billing.getRecord.mockResolvedValue({ unitPrice: 2, usageType: UsageType.DURATION, status: 'pre_deducted', billingPolicy: 'internal', estimatedCost: 10, apiKey: 'test', maxCharge: 10 });
    await adapter.settle({ taskId: 't', actualUsage: { usageType: UsageType.DURATION, usageValue: 8 } });
    expect(wallet.debit).toHaveBeenCalledWith('test', 10, 't');
    expect(billing.settle).toHaveBeenCalledWith('t', 8, 10);
  });
  it('accepts a genuinely free estimate with a zero charge ceiling', async () => {
    pricing.estimate.mockResolvedValue({ estimatedCost: 0, usageType: UsageType.COUNT });
    await adapter.initBilling({ taskId: 'free', apiKey: 'test', model: 'm', provider: 'test', featureType: 'textToImage', input: {}, maxCharge: 0 });
    expect(billing.createRecord).toHaveBeenCalledWith(expect.objectContaining({ maxCharge: 0, estimate: expect.objectContaining({ estimatedCost: 0 }) }));
  });
  it('preserves legacy billing when no server ceiling was provided', async () => {
    billing.getRecord.mockResolvedValue({ unitPrice: 2, usageType: UsageType.DURATION, status: 'pre_deducted', billingPolicy: 'internal', estimatedCost: 10, apiKey: 'test' });
    await adapter.settle({ taskId: 't', actualUsage: { usageType: UsageType.DURATION, usageValue: 8 } });
    expect(wallet.debit).toHaveBeenCalledWith('test', 16, 't');
  });
  it('settles complete LLM token usage and caps input plus output charges at the accepted quote', async () => {
    billing.getRecord.mockResolvedValue({ unitPrice: 0.001, usageType: UsageType.TOKEN, status: 'estimated', billingPolicy: 'internal', estimatedCost: 4.096, apiKey: 'test', maxCharge: 4.096 });
    await adapter.settle({ taskId: 'llm', actualUsage: { usageType: UsageType.COUNT, usageValue: 1 }, requestInput: { max_tokens: 4096 }, usageParam: 'max_tokens', rawUsageResult: { choices: [{ message: { content: '剧本' } }], usage: { prompt_tokens: 1000, completion_tokens: 4096, total_tokens: 5096 } } });
    expect(wallet.debit).toHaveBeenCalledWith('test', 4.096, 'llm');
    expect(billing.settle).toHaveBeenCalledWith('llm', 5096, 4.096);
  });
  it('reserves a browser token estimate without creating a charge ceiling', async () => {
    pricing.estimate.mockResolvedValue({ estimatedCost: 40.96, usageType: UsageType.TOKEN });
    await adapter.initBilling({ taskId: 'browser', apiKey: 'test', model: 'm', provider: 'test', featureType: 'textGenerate', input: {}, reserveEstimate: true });
    expect(wallet.freeze).toHaveBeenCalledWith('test', 40.96, 'browser');
    expect(billing.createRecord.mock.calls[0][0]).not.toHaveProperty('maxCharge');
  });
  it('settles full input and output usage even when it exceeds the browser estimate', async () => {
    billing.getRecord.mockResolvedValue({ unitPrice: 0.01, usageType: UsageType.TOKEN, status: 'pre_deducted', billingPolicy: 'internal', estimatedCost: 40.96, apiKey: 'test' });
    await adapter.settle({ taskId: 'browser', actualUsage: { usageType: UsageType.COUNT, usageValue: 1 }, requestInput: { max_tokens: 4096 }, rawUsageResult: { usage: { prompt_tokens: 223, completion_tokens: 4096, total_tokens: 4319 } } });
    expect(wallet.debit).toHaveBeenCalledWith('test', 43.19, 'browser');
    expect(billing.settle).toHaveBeenCalledWith('browser', 4319, 43.19);
  });
});
