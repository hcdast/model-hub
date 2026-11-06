import { validate } from 'class-validator';
import { CreditWalletDto } from '../billing/dto/credit-wallet.dto';
import { AdminBillingController } from './admin-billing.controller';

describe('Admin credit request identity', () => {
  const operationId = 'f29b96c2-2f17-4173-876b-4764feea98d3';
  it.each([undefined, '', 'not-a-uuid'])('rejects a missing or malformed operation ID: %s', async value => {
    const dto = Object.assign(new CreditWalletDto(), { amount: 10, reason: 'manual', operationId: value });
    expect((await validate(dto)).some(error => error.property === 'operationId')).toBe(true);
  });
  it('validates the operation identity and forwards it to the transactional manual-credit path', async () => {
    const dto = Object.assign(new CreditWalletDto(), { amount: 10, reason: 'manual', operationId });
    expect(await validate(dto)).toEqual([]);
    const wallet = { creditManually: jest.fn().mockResolvedValue(undefined), getBalance: jest.fn().mockResolvedValue({ balance: 10 }) };
    const controller = new AdminBillingController({} as any, wallet as any, {} as any);
    await controller.creditWallet('fixture-key', dto);
    expect(wallet.creditManually).toHaveBeenCalledWith('fixture-key', 10, 'manual', operationId);
  });
});
