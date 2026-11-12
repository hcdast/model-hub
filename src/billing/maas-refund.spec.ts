import { BillingAdapter } from './billing.adapter';

describe('MaaS terminal refund accounting', () => {
  function fixture() {
    const billing: any = { transaction: (work: any) => work(), getRecord: jest.fn().mockResolvedValue({ apiKey: 'test', billingPolicy: 'internal', status: 'pre_deducted', estimatedCost: 150 }), markRefunded: jest.fn() };
    const wallet: any = { unfreeze: jest.fn().mockResolvedValue(undefined) };
    const adapter = new BillingAdapter({} as any, {} as any, {} as any, billing, wallet, {} as any);
    return { adapter, wallet, billing };
  }
  it('unfreezes the original reservation on upstream cancellation', async () => {
    const { adapter, wallet, billing } = fixture();
    await adapter.refund({ taskId: 'task', reason: 'provider_cancelled' });
    expect(wallet.unfreeze).toHaveBeenCalledWith('test', 150, 'task', undefined);
    expect(billing.markRefunded).toHaveBeenCalledWith('task');
  });
  it('does not report refunded when wallet unfreeze fails', async () => {
    const { adapter, wallet, billing } = fixture(); wallet.unfreeze.mockRejectedValue(new Error('unavailable'));
    await expect(adapter.refund({ taskId: 'task', reason: 'provider_cancelled' })).rejects.toThrow('unavailable');
    expect(wallet.unfreeze).toHaveBeenCalledTimes(1);
    expect(billing.markRefunded).not.toHaveBeenCalled();
  });
});
