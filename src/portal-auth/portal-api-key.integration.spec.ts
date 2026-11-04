import { createConnection, Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PortalApiKeyService } from './portal-api-key.service';
import { PortalApiKey, PortalApiKeySchema } from '../database/schemas/portal-api-key.schema';
import { PortalUser, PortalUserSchema } from '../database/schemas/portal-user.schema';

describe('Portal API Key creation and workflow billing lookup', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let keys: Model<PortalApiKey>;
  let users: Model<PortalUser>;
  let service: PortalApiKeyService;
  const wallet = { ensureWallet: jest.fn().mockResolvedValue({ balance: 0 }) };
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await createConnection(mongo.getUri()).asPromise();
    keys = connection.model(PortalApiKey.name, PortalApiKeySchema);
    users = connection.model(PortalUser.name, PortalUserSchema);
    service = new PortalApiKeyService(keys as never, users as never, wallet as never);
    await keys.init();
  }, 60000);
  beforeEach(async () => {
    await keys.deleteMany({}); await users.deleteMany({}); wallet.ensureWallet.mockClear();
    await users.collection.insertOne({ _id: new Types.ObjectId(userId), status: 'active', role: 'user' } as never);
  });
  afterAll(async () => { await connection?.close(); await mongo?.stop(); });

  it('persists the requested name and provides a billing identity after creation without exposing the secret', async () => {
    const created = await service.create(userId, '  Workflow billing  ');
    expect(created.name).toBe('Workflow billing');
    expect(created.apiKey).toMatch(/^mh_/);
    const key = await keys.findById(created.id).lean();
    expect(key?.name).toBe('Workflow billing');
    expect(key?.secretHash).toBeUndefined();
    expect(await service.findExecutionBillingKey(userId)).toBe(key?.billingKey);
    expect(wallet.ensureWallet).toHaveBeenCalledWith(key?.billingKey);
    expect((await service.listByUser(userId))[0].apiKey).not.toBe(created.apiKey);
  });

  it.each(['absent', 'null', 'future'] as const)('includes an enabled key with %s expiry in list, quota and workflow lookup', async expiry => {
    await keys.collection.insertOne({ userId, name: 'existing', slot: 0, keyId: 'existing', billingKey: 'portal:existing', enabled: true,
      ...(expiry === 'null' ? { expiresAt: null } : expiry === 'future' ? { expiresAt: new Date(Date.now() + 600000) } : {}) } as never);
    expect(await service.findExecutionBillingKey(userId)).toBe('portal:existing');
    expect(await service.listByUser(userId)).toHaveLength(1);
    expect((await service.getUserLimits(userId)).apiKey.currentCount).toBe(1);
  });

  it('ignores disabled, expired and other-user keys without creating a key or wallet as a fallback', async () => {
    await keys.collection.insertMany([
      { userId, slot: 0, keyId: 'disabled', billingKey: 'portal:disabled', enabled: false },
      { userId, slot: 1, keyId: 'expired', billingKey: 'portal:expired', enabled: true, expiresAt: new Date(Date.now() - 60000) },
      { userId: 'other-user', slot: 0, keyId: 'other', billingKey: 'portal:other', enabled: true },
    ] as never);
    expect(await service.findExecutionBillingKey(userId)).toBeNull();
    expect(wallet.ensureWallet).not.toHaveBeenCalled();
    expect(await keys.countDocuments()).toBe(3);
  });
});
