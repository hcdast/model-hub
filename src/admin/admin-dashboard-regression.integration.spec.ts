import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, createConnection, Schema, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StatsService } from '../stats/stats.service';
import { AdminAccountCostController } from './admin-account-cost.controller';
import { WalletService } from '../billing/wallet.service';
import { WalletSchema } from '../database/schemas/wallet.schema';
import { AdminBillingController } from './admin-billing.controller';
import { resolveAdminClientKey, withClientDisplay } from './utils/client-display';

/** Uses a disposable MongoDB, never the configured application database. */
describe('Admin reporting, export and reservation regression', () => {
  let mongo: MongoMemoryReplSet, db: Connection;
  let tasks: any, costs: any, wallets: any, clients: any, transactions: any;
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1 } });
    db = await createConnection(mongo.getUri()).asPromise();
    tasks = db.model('RegressionTasks', new Schema({}, { strict: false }));
    costs = db.model('RegressionCosts', new Schema({}, { strict: false }));
    wallets = db.model('RegressionWallets', WalletSchema);
    clients = db.model('RegressionClients', new Schema({}, { strict: false }));
    transactions = db.model('RegressionTransactions', new Schema({}, { strict: false }));
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => { await Promise.all([tasks, costs, wallets, clients, transactions].map(m => m.deleteMany({}))); });

  it('includes more than 100 groups, successful live tasks and UTC date boundaries on every detail page', async () => {
    await tasks.insertMany(Array.from({ length: 125 }, (_, i) => ({ model: `model-${i}`, provider: 'test', featureType: 'textToImage', status: i < 101 ? 'SUCCESS' : 'FAILED', createdAt: new Date('2026-05-01T23:59:59Z'), timing: { totalE2eMs: 100 } })));
    await tasks.create({ model: 'outside', status: 'SUCCESS', createdAt: new Date('2026-05-02T00:00:00Z') });
    const stats = new StatsService(tasks, {} as any);
    const first = await stats.queryDaily({ dateFrom: '2026-05-01', dateTo: '2026-05-01' }, 1, 20);
    const last = await stats.queryDaily({ dateFrom: '2026-05-01', dateTo: '2026-05-01' }, 7, 20);
    expect(first.total).toBe(125); expect(first.items).toHaveLength(20); expect(last.items).toHaveLength(5);
    expect(first.summary).toMatchObject({ totalCount: 125, successCount: 101, failedCount: 24 });
    expect(last.summary).toEqual(first.summary); expect(first.trend[0].totalCount).toBe(125);
    expect(first.source).toBe('tasks'); expect(first.timezone).toBe('UTC');
    await expect(stats.queryDaily({ dateFrom: '2026-02-30' })).rejects.toThrow();
  });

  it('aggregates a historical cross-month range independently of daily pagination', async () => {
    await costs.insertMany(Array.from({ length: 125 }, (_, i) => ({ date: i % 2 ? '2026-05-31' : '2026-06-01', account_id: `account-${i}`, provider_name: 'test', total_cost: 2, request_count: 2, success_count: 1, failure_count: 1, avg_latency_ms: 500 })));
    await costs.create({ date: '2026-11-01', account_id: 'current', total_cost: 999 });
    const controller = new AdminAccountCostController(costs);
    const result = (await controller.rangeSummary(undefined, undefined, '2026-05-31', '2026-06-01')).data;
    expect(result.items).toHaveLength(125); expect(result.trend).toHaveLength(2);
    expect(result.items.reduce((n: number, r: any) => n + r.total_cost, 0)).toBe(250);
    expect((await controller.listDaily(undefined, undefined, '2026-05-31', '2026-06-01', '1', '20')).data.total).toBe(125);
    await expect(controller.monthlyAggregate(undefined, undefined, '2026-13')).rejects.toThrow();
  });

  function walletService() { return new WalletService(wallets, transactions, clients, new EventEmitter2(), {} as any); }
  it('releases a tracked reservation exactly once under concurrency without releasing another task', async () => {
    const service = walletService();
    await wallets.create({ apiKey: 'test-client', balance: 100 });
    expect(await service.freeze('test-client', 10, 'first')).toBe(true);
    expect(await service.freeze('test-client', 20, 'second')).toBe(true);
    expect(await service.freeze('test-client', 10, 'first')).toBe(false);
    await Promise.all(Array.from({ length: 8 }, () => service.unfreeze('test-client', 10, 'first', true)));
    expect((await service.getBalance('test-client')).frozenAmount).toBe(20);
    expect(await transactions.countDocuments({ relatedTaskId: 'first', type: 'unfreeze' })).toBe(1);
    await service.unfreeze('test-client', 20, 'second', true);
    expect((await service.getBalance('test-client')).frozenAmount).toBe(0);
  });
  it('records a legacy release receipt and rejects an inconsistent reservation', async () => {
    const service = walletService();
    await wallets.create({ apiKey: 'legacy', balance: 100, frozenAmount: 30 });
    await Promise.all(Array.from({ length: 8 }, () => service.unfreeze('legacy', 10, 'old-task')));
    expect((await service.getBalance('legacy')).frozenAmount).toBe(20);
    await expect(service.unfreeze('legacy', 50, 'other-task')).rejects.toThrow('inconsistent');
  });

  it('exports all 125 filtered rows with formula escaping and no raw API key', async () => {
    const secret = 'test-only-secret-key';
    await clients.create({ apiKey: secret, name: '=UNTRUSTED()' });
    const rows = Array.from({ length: 125 }, (_, i) => ({ taskId: `task-${i}`, apiKey: secret, model: 'test/model', currency: 'credit', createdAt: new Date('2026-05-01') }));
    const billing = { listRecords: jest.fn(async (q: any) => ({ total: 125, items: rows.slice((q.page - 1) * 100, q.page * 100) })) };
    const result = (await new AdminBillingController(billing as any, {} as any, clients).exportRecords({ model: 'test/model' })).data;
    expect(result.total).toBe(125); expect(result.csv.split('\r\n')).toHaveLength(126);
    expect(result.csv).not.toContain(secret); expect(result.csv).toContain("'=UNTRUSTED()");
    expect(billing.listRecords).toHaveBeenCalledTimes(2);
  });

  it('resolves Portal application ownership without returning its billing credential', async () => {
    const userId = new Types.ObjectId();
    await db.collection('portal_users').insertOne({ _id: userId, username: 'Regression User' });
    const key = await db.collection('portal_api_keys').insertOne({ billingKey: 'fixture-billing-key', userId: String(userId), name: 'Test App' });
    const [row] = await withClientDisplay(clients, [{ apiKey: 'fixture-billing-key' }]);
    expect(row.clientName).toBe('Regression User / Test App');
    expect(row.clientRef).toBe(`portal-key:${key.insertedId}`);
    expect(JSON.stringify(row)).not.toContain('fixture-billing-key');
    expect(await resolveAdminClientKey(clients, row.clientRef!)).toBe('fixture-billing-key');
  });
});
