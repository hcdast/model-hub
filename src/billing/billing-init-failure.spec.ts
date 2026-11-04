import { BillingAdapter } from './billing.adapter';
import { InsufficientBalanceException } from './exceptions/insufficient-balance.exception';
import { UsageType } from './interfaces/billing.interface';

describe('Billing initialization reservation failure', () => {
  const client: any = { findOne: jest.fn(() => ({ select: () => ({ lean: async () => ({ billingPolicy: 'internal' }) }) })) };
  const pricing: any = { estimate: jest.fn() };
  const billing: any = { transaction: (work: any) => work(), getRecord: jest.fn().mockResolvedValue(null), createRecord: jest.fn(), markFailed: jest.fn(), markPreDeducted: jest.fn() };
  const wallet: any = { freeze: jest.fn() };
  const adapter = new BillingAdapter(client, {} as any, pricing, billing, wallet);
  const context = { taskId: 'unsubmitted-task', apiKey: 'test-client', model: 'image', provider: 'test', featureType: 'textToImage', input: {} };
  beforeEach(() => {
    jest.clearAllMocks();
    pricing.estimate.mockResolvedValue({ usageType: UsageType.COUNT, estimatedCost: 2 });
  });
  it('closes the estimate when the wallet rejects the reservation, without marking a deduction', async () => {
    wallet.freeze.mockResolvedValue(false);
    await expect(adapter.initBilling(context)).rejects.toBeInstanceOf(InsufficientBalanceException);
    expect(billing.markFailed).toHaveBeenCalledWith('unsubmitted-task', 'INSUFFICIENT_BALANCE');
    expect(billing.markPreDeducted).not.toHaveBeenCalled();
  });
  it('keeps a successful reservation awaiting settlement', async () => {
    wallet.freeze.mockResolvedValue(true);
    await adapter.initBilling(context);
    expect(billing.markPreDeducted).toHaveBeenCalledWith('unsubmitted-task');
    expect(billing.markFailed).not.toHaveBeenCalled();
  });
  it('leaves token estimates open without freezing funds', async () => {
    pricing.estimate.mockResolvedValue({ usageType: UsageType.TOKEN, estimatedCost: 2 });
    await adapter.initBilling(context);
    expect(wallet.freeze).not.toHaveBeenCalled();
    expect(billing.markFailed).not.toHaveBeenCalled();
  });
});
