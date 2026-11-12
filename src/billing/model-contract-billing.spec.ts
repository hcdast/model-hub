import { BillingAdapter } from './billing.adapter';
import { UsageType } from './interfaces/billing.interface';

describe('Model contract billing settlement', () => {
  const record = { apiKey: 'billing-key', unitPrice: 3, usageType: 'duration', estimatedUsage: 30, billingPolicy: 'external' };
  const billing: any = { transaction: (work: any) => work(), getRecord: jest.fn(), settle: jest.fn() };
  const adapter = new BillingAdapter({} as any, {} as any, {} as any, billing, {} as any, {} as any);
  beforeEach(() => { jest.clearAllMocks(); billing.getRecord.mockResolvedValue(record); });
  it('uses original price/type with provider actual duration rather than same-name config', async () => {
    await adapter.settle({ taskId: 'task', actualUsage: { usageType: UsageType.TOKEN, usageValue: 999 }, requestInput: { seconds: -1 }, usageParam: 'seconds', rawUsageResult: { data: { content: { duration: 7 } } } });
    expect(billing.settle).toHaveBeenCalledWith('task', 7, 21);
  });
  it('uses positive reserved usage for auto-duration when provider does not report duration', async () => {
    await adapter.settle({ taskId: 'task', actualUsage: { usageType: UsageType.DURATION, usageValue: 5 }, requestInput: { duration: -1 }, resultPayload: ['https://example.com/video.mp4'] });
    expect(billing.settle).toHaveBeenCalledWith('task', 30, 90);
  });
});
