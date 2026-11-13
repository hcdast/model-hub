import { EventEmitter2 } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, createConnection, Model, Schema, Types } from 'mongoose';
import { PortalApiKeyService } from './portal-api-key.service';
import { PortalUser, PortalUserSchema } from '../database/schemas/portal-user.schema';
import { PortalApiKey, PortalApiKeySchema } from '../database/schemas/portal-api-key.schema';
import { WalletSchema } from '../database/schemas/wallet.schema';
import { WalletTransactionSchema } from '../database/schemas/wallet-transaction.schema';
import { BillingRecordSchema } from '../database/schemas/billing-record.schema';
import { WalletService } from '../billing/wallet.service';
import { BillingService } from '../billing/billing.service';
import { BillingAdapter } from '../billing/billing.adapter';
import { UsageType } from '../billing/interfaces/billing.interface';
import { InsufficientBalanceException } from '../billing/exceptions/insufficient-balance.exception';
import { resolveAdminClientKey, withClientDisplay } from '../admin/utils/client-display';

describe('Browser account billing without developer API keys', () => {
  let mongo: MongoMemoryReplSet, db: Connection;
  let users: Model<PortalUser>, keys: Model<PortalApiKey>, wallets: Model<any>, ledger: Model<any>, bills: Model<any>, clients: Model<any>;
  let service: PortalApiKeyService, wallet: WalletService, billing: BillingService, adapter: BillingAdapter;
  const owner = new Types.ObjectId().toString(), other = new Types.ObjectId().toString();
  const pricing = { estimate: jest.fn() };
  const task = (apiKey: string, taskId = 'script') => ({ apiKey, taskId, model: 'test-script', provider: 'test', featureType: 'textGenerate', input: {}, reserveEstimate: true });

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1 } });
    db = await createConnection(mongo.getUri()).asPromise();
    users = db.model(PortalUser.name, PortalUserSchema); keys = db.model(PortalApiKey.name, PortalApiKeySchema);
    wallets = db.model('Wallet', WalletSchema); ledger = db.model('WalletTransaction', WalletTransactionSchema); bills = db.model('BillingRecord', BillingRecordSchema);
    clients = db.model('BrowserTestClient', new Schema({}, { strict: false }));
    await Promise.all([users.init(), keys.init(), wallets.init(), ledger.init(), bills.init(), clients.init()]);
    wallet = new WalletService(wallets as never, ledger as never, clients as never, new EventEmitter2(), {} as never);
    billing = new BillingService(bills as never);
    service = new PortalApiKeyService(keys as never, users as never, wallet);
    adapter = new BillingAdapter(clients as never, keys as never, pricing as never, billing, wallet, users as never);
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), keys.deleteMany({}), wallets.deleteMany({}), ledger.deleteMany({}), bills.deleteMany({}), clients.deleteMany({})]);
    await users.collection.insertMany([owner, other].map(id => ({ _id: new Types.ObjectId(id), email: `${id}@example.com`, status: 'active', role: 'user', username: id === owner ? 'Creator' : 'Other' })) as never);
    pricing.estimate.mockResolvedValue({ usageType: UsageType.TOKEN, estimatedUsage: 2, estimatedCost: 2, unitPrice: 1, currency: 'credit' });
  });

  it('provisions one stable zero-balance wallet concurrently, without API secrets or key quota use', async () => {
    const resolved = await Promise.all(Array.from({ length: 12 }, () => service.ensureExecutionBillingKey(owner)));
    expect(new Set(resolved)).toEqual(new Set([`portal:${owner}`]));
    expect(await wallets.countDocuments()).toBe(1);
    expect(await wallet.getBalance(resolved[0])).toEqual({ balance: 0, available: 0, frozenAmount: 0 });
    expect(await keys.countDocuments()).toBe(0); expect(await ledger.countDocuments()).toBe(0);
    expect((await service.getUserLimits(owner)).apiKey.currentCount).toBe(0);
    expect(await adapter.resolvePolicy(resolved[0])).toBe('internal');
    expect(await service.validate(resolved[0])).toBeNull();
    const another = await service.ensureExecutionBillingKey(other);
    expect(another).not.toBe(resolved[0]);
  });

  it('preserves the previous internal wallet and its funds after deleting developer credentials', async () => {
    const created = await service.create(owner, 'Existing developer key');
    const legacy = (await keys.findById(created.id).lean())!;
    await wallets.updateOne({ apiKey: legacy.billingKey }, { $set: { balance: 12 } });
    expect(await service.ensureExecutionBillingKey(owner)).toBe(legacy.billingKey);
    await service.delete(owner, created.id);
    expect(await service.ensureExecutionBillingKey(owner)).toBe(legacy.billingKey);
    expect(await adapter.resolvePolicy(legacy.billingKey)).toBe('internal');
    expect(await wallet.getBalance(legacy.billingKey)).toMatchObject({ available: 12 });
    expect(await wallets.countDocuments()).toBe(1); expect(await keys.countDocuments()).toBe(0);
    const [display] = await withClientDisplay(clients, [{ apiKey: legacy.billingKey }]);
    expect(display).toMatchObject({ clientName: 'Creator / 网页创作', clientRef: `portal:${owner}` });
    expect(await resolveAdminClientKey(clients, display.clientRef)).toBe(legacy.billingKey);
  });

  it('does not adopt disabled, expired, exempt, external or another account’s developer wallet', async () => {
    await keys.collection.insertMany([
      { userId: owner, slot: 0, keyId: 'disabled', billingKey: 'portal:disabled', enabled: false, billingPolicy: 'internal' },
      { userId: owner, slot: 1, keyId: 'expired', billingKey: 'portal:expired', enabled: true, billingPolicy: 'internal', expiresAt: new Date(0) },
      { userId: owner, slot: 2, keyId: 'exempt', billingKey: 'portal:exempt', enabled: true, billingPolicy: 'exempt' },
      { userId: owner, slot: 3, keyId: 'external', billingKey: 'portal:external', enabled: true, billingPolicy: 'external' },
      { userId: other, slot: 0, keyId: 'other', billingKey: 'portal:other', enabled: true, billingPolicy: 'internal' },
    ] as never);
    expect(await service.ensureExecutionBillingKey(owner)).toBe(`portal:${owner}`);
    await expect(adapter.resolvePolicy('portal:unregistered')).rejects.toThrow('No billing policy');
  });

  it('rejects missing, suspended and deleted accounts without creating wallets', async () => {
    await users.updateOne({ _id: owner }, { $set: { status: 'suspended' } });
    await users.updateOne({ _id: other }, { $set: { deletedAt: new Date() } });
    for (const id of [owner, other, new Types.ObjectId().toString()]) await expect(service.ensureExecutionBillingKey(id)).rejects.toThrow('账号不可用');
    expect(await wallets.countDocuments()).toBe(0);
  });

  it('blocks a paid token task with no funds, then reserves and settles once after funding', async () => {
    const identity = await service.ensureExecutionBillingKey(owner);
    await expect(adapter.initBilling(task(identity, 'unfunded'))).rejects.toBeInstanceOf(InsufficientBalanceException);
    expect((await billing.getRecord('unfunded'))?.status).toBe('failed');
    expect(await ledger.countDocuments()).toBe(0);
    await wallets.updateOne({ apiKey: identity }, { $set: { balance: 10 } });
    await adapter.initBilling(task(identity)); await adapter.initBilling(task(identity));
    expect(await wallet.getBalance(identity)).toMatchObject({ available: 8, frozenAmount: 2 });
    pricing.estimate.mockResolvedValueOnce({ usageType: UsageType.TOKEN, estimatedUsage: 10, estimatedCost: 10, unitPrice: 1, currency: 'credit' });
    await expect(adapter.initBilling(task(identity, 'too-large'))).rejects.toBeInstanceOf(InsufficientBalanceException);
    const result = { taskId: 'script', actualUsage: { usageType: UsageType.TOKEN, usageValue: 5 } };
    await adapter.settle(result); await adapter.settle(result);
    expect(await wallet.getBalance(identity)).toMatchObject({ balance: 5, frozenAmount: 0 });
    expect(await billing.getRecord('script')).toMatchObject({ status: 'settled', actualUsage: 5, actualCost: 5 });
    expect(await bills.collection.findOne({ taskId: 'script' })).not.toHaveProperty('maxCharge');
    expect(await ledger.countDocuments({ type: 'debit' })).toBe(1);
  });

  it('keeps settlement pending when actual usage exceeds available funds, then settles the full amount once after funding', async () => {
    const identity = await service.ensureExecutionBillingKey(owner);
    await wallets.updateOne({ apiKey: identity }, { $set: { balance: 2 } });
    await adapter.initBilling(task(identity));
    const result = { taskId: 'script', actualUsage: { usageType: UsageType.TOKEN, usageValue: 5 } };
    await expect(adapter.settle(result)).rejects.toThrow('Debit failed');
    expect(await wallet.getBalance(identity)).toMatchObject({ balance: 2, frozenAmount: 2 });
    expect(await billing.getRecord('script')).toMatchObject({ status: 'pre_deducted' });
    expect(await ledger.countDocuments({ type: 'debit' })).toBe(0);
    await wallets.updateOne({ apiKey: identity }, { $inc: { balance: 5 } });
    await adapter.settle(result); await adapter.settle(result);
    expect(await wallet.getBalance(identity)).toMatchObject({ balance: 2, frozenAmount: 0 });
    expect(await billing.getRecord('script')).toMatchObject({ status: 'settled', actualCost: 5 });
    expect(await ledger.countDocuments({ type: 'debit' })).toBe(1);
  });

  it('releases a token reservation on failure without a charge and rejects a suspended account', async () => {
    const identity = await service.ensureExecutionBillingKey(owner);
    await wallets.updateOne({ apiKey: identity }, { $set: { balance: 10 } });
    await adapter.initBilling(task(identity));
    await adapter.refund({ taskId: 'script', reason: 'provider failed' });
    await adapter.refund({ taskId: 'script', reason: 'repeated callback' });
    expect(await wallet.getBalance(identity)).toEqual({ balance: 10, available: 10, frozenAmount: 0 });
    await users.updateOne({ _id: owner }, { $set: { status: 'suspended' } });
    await expect(adapter.initBilling(task(identity, 'inactive'))).rejects.toThrow('inactive');
    expect(await bills.findOne({ taskId: 'inactive' }).lean()).toBeNull();
  });
});
