import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection, Schema } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { BillingAdapter } from './billing.adapter';
import { WalletSchema } from '../database/schemas/wallet.schema';
import { WalletTransactionSchema } from '../database/schemas/wallet-transaction.schema';
import { BillingRecordSchema } from '../database/schemas/billing-record.schema';
import { UsageType } from './interfaces/billing.interface';
import { spawn } from 'child_process';

describe('Financial atomicity on a disposable replica set', () => {
  let mongo: MongoMemoryReplSet, db: Connection;
  let wallets: any, ledger: any, bills: any, wallet: WalletService, billing: BillingService, adapter: BillingAdapter;
  const input = { taskId: 'task', apiKey: 'client', model: 'model', provider: 'test', featureType: 'textToImage', input: {} };
  const settle = { taskId: 'task', actualUsage: { usageType: UsageType.COUNT, usageValue: 1 } };
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1 }, instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] });
    db = await createConnection(mongo.getUri()).asPromise();
    wallets = db.model('Wallet', WalletSchema); ledger = db.model('WalletTransaction', WalletTransactionSchema);
    bills = db.model('BillingRecord', BillingRecordSchema);
    const clients = db.model('TestClient', new Schema({}, { strict: false }));
    await Promise.all([wallets.init(), ledger.init(), bills.init(), clients.init()]);
    wallet = new WalletService(wallets, ledger, clients as any, new EventEmitter2(), {} as any);
    billing = new BillingService(bills);
    const client: any = { findOne: () => ({ select: () => ({ lean: async () => ({ billingPolicy: 'internal' }) }) }) };
    adapter = new BillingAdapter(client, {} as any, { estimate: async () => ({ usageType: UsageType.COUNT, estimatedUsage: 1, estimatedCost: 10, unitPrice: 10, currency: 'credit' }) } as any, billing, wallet);
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([wallets.deleteMany({}), ledger.deleteMany({}), bills.deleteMany({})]);
    await wallets.create({ apiKey: 'client', balance: 100 });
  });
  it('rolls back wallet, ledger and estimate if the final reservation state write fails', async () => {
    jest.spyOn(billing, 'markPreDeducted').mockRejectedValueOnce(new Error('injected bill failure'));
    await expect(adapter.initBilling(input)).rejects.toThrow('injected');
    expect(await wallet.getBalance('client')).toMatchObject({ balance: 100, frozenAmount: 0 });
    expect(await ledger.countDocuments()).toBe(0); expect(await bills.countDocuments()).toBe(0);
  });
  it('rolls back a credit when its ledger write fails', async () => {
    jest.spyOn(ledger, 'create').mockRejectedValueOnce(new Error('injected ledger failure'));
    await expect(wallet.credit('client', 5, 'test')).rejects.toThrow('injected');
    expect((await wallet.getBalance('client')).balance).toBe(100);
  });
  it('rolls back release and debit if final settlement fails; a retry charges once', async () => {
    await adapter.initBilling(input);
    jest.spyOn(billing, 'settle').mockRejectedValueOnce(new Error('injected settlement failure'));
    await expect(adapter.settle(settle)).rejects.toThrow('injected');
    expect(await wallet.getBalance('client')).toMatchObject({ balance: 100, frozenAmount: 10 });
    expect((await billing.getRecord('task'))?.status).toBe('pre_deducted');
    expect(await ledger.countDocuments()).toBe(1);
    await adapter.settle(settle); await adapter.settle(settle);
    expect(await wallet.getBalance('client')).toMatchObject({ balance: 90, frozenAmount: 0 });
    expect(await ledger.countDocuments({ type: 'debit' })).toBe(1);
  });
  it('rolls back release when the refund state fails', async () => {
    await adapter.initBilling(input);
    jest.spyOn(billing, 'markRefunded').mockRejectedValueOnce(new Error('injected refund failure'));
    await expect(adapter.refund({ taskId: 'task', reason: 'test' })).rejects.toThrow('injected');
    expect((await wallet.getBalance('client')).frozenAmount).toBe(10);
    expect((await billing.getRecord('task'))?.status).toBe('pre_deducted');
    expect(await ledger.countDocuments()).toBe(1);
  });
  it('serializes racing settlement and refund callbacks into one terminal outcome', async () => {
    await adapter.initBilling(input); await adapter.initBilling(input);
    await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? adapter.settle(settle) : adapter.refund({ taskId: 'task', reason: 'race' })));
    const bill = await billing.getRecord('task'), balance = await wallet.getBalance('client');
    expect(['settled', 'refunded']).toContain(bill?.status);
    expect(balance.frozenAmount).toBe(0);
    expect(balance.balance).toBe(bill?.status === 'settled' ? 90 : 100);
    expect(await ledger.countDocuments({ type: 'unfreeze' })).toBe(1);
    expect(await ledger.countDocuments({ type: 'debit' })).toBe(bill?.status === 'settled' ? 1 : 0);
  });
  it('does not consume another reservation when actual funds are insufficient', async () => {
    await adapter.initBilling(input); await wallet.freeze('client', 90, 'other');
    await expect(adapter.settle({ ...settle, actualUsage: { usageType: UsageType.COUNT, usageValue: 2 } })).rejects.toThrow('Debit failed');
    expect(await wallet.getBalance('client')).toMatchObject({ balance: 100, frozenAmount: 100 });
    expect(await ledger.countDocuments({ type: 'unfreeze' })).toBe(0);
  });
  it('releases the last fractional hold despite binary residue and still rejects genuine shortages or wrong owners', async () => {
    await wallet.freeze('client', 0.55, 'first-fraction');
    await wallet.freeze('client', 0.22, 'last-fraction');
    await wallet.unfreeze('client', 0.55, 'first-fraction', true);
    expect((await wallets.findOne({ apiKey: 'client' })).frozenAmount).toBeLessThan(0.22);
    await expect(wallet.unfreeze('client', 0.22, 'wrong-task', true)).rejects.toThrow('inconsistent');
    await wallet.unfreeze('client', 0.22, 'last-fraction', true);
    await wallet.unfreeze('client', 0.22, 'last-fraction', true);
    expect((await wallets.findOne({ apiKey: 'client' })).frozenAmount).toBe(0);
    expect(await ledger.countDocuments({ relatedTaskId: 'last-fraction', type: 'unfreeze' })).toBe(1);
    await wallet.freeze('client', 0.22, 'genuine-shortage');
    await wallets.updateOne({ apiKey: 'client' }, { $set: { frozenAmount: 0.22 - 1e-10 } });
    await expect(wallet.unfreeze('client', 0.22, 'genuine-shortage', true)).rejects.toThrow('inconsistent');
    expect(await ledger.countDocuments({ relatedTaskId: 'genuine-shortage', type: 'unfreeze' })).toBe(0);
  });
  it('records repeated direct debit and credit requests once', async () => {
    await Promise.all(Array.from({ length: 6 }, () => wallet.debit('client', 10, 'same')));
    await Promise.all(Array.from({ length: 6 }, () => wallet.credit('client', 3, 'retry', 'same-credit')));
    expect((await wallet.getBalance('client')).balance).toBe(93);
    expect(await ledger.countDocuments()).toBe(2);
  });
  it('deduplicates concurrent manual-credit retries and later retries with one durable receipt', async () => {
    await Promise.all(Array.from({ length: 10 }, () => wallet.creditManually('client', 5, 'manual topup', 'operation-one')));
    await wallet.creditManually('client', 5, 'manual topup', 'operation-one');
    expect((await wallet.getBalance('client')).balance).toBe(105);
    expect(await ledger.countDocuments({ operationId: 'operation-one' })).toBe(1);
    expect((await ledger.findOne({ operationId: 'operation-one' })).relatedTaskId).toBeUndefined();
  });
  it('rejects reuse with a different amount or reason; different operation IDs remain separate topups', async () => {
    await wallet.creditManually('client', 5, 'first', 'manual-id');
    await expect(wallet.creditManually('client', 6, 'first', 'manual-id')).rejects.toThrow('不同的充值');
    await expect(wallet.creditManually('client', 5, 'changed', 'manual-id')).rejects.toThrow('不同的充值');
    await wallet.creditManually('client', 5, 'first', 'another-id');
    expect((await wallet.getBalance('client')).balance).toBe(110);
    expect(await ledger.countDocuments()).toBe(2);
  });
  it('rolls back a failed manual receipt and allows retry of that exact operation', async () => {
    jest.spyOn(ledger, 'create').mockRejectedValueOnce(new Error('injected manual receipt failure'));
    await expect(wallet.creditManually('client', 5, 'retry', 'receipt-failure')).rejects.toThrow('injected');
    expect((await wallet.getBalance('client')).balance).toBe(100);
    expect(await ledger.countDocuments()).toBe(0);
    await wallet.creditManually('client', 5, 'retry', 'receipt-failure');
    expect((await wallet.getBalance('client')).balance).toBe(105);
  });
  it('survives an interrupted manual-credit commit response without crediting twice', async () => {
    await db.db!.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['commitTransaction'], closeConnection: true } });
    await wallet.creditManually('client', 5, 'lost response', 'lost-response');
    await wallet.creditManually('client', 5, 'lost response', 'lost-response');
    expect((await wallet.getBalance('client')).balance).toBe(105);
    expect(await ledger.countDocuments()).toBe(1);
  });
  it('retries an interrupted commit response without duplicating a financial write', async () => {
    await db.db!.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['commitTransaction'], closeConnection: true } });
    await wallet.credit('client', 5, 'commit retry', 'commit-retry');
    expect((await wallet.getBalance('client')).balance).toBe(105);
    expect(await ledger.countDocuments()).toBe(1);
  });
  it('never exposes partial money writes after the writer process is killed before commit', async () => {
    const code = `const mongoose=require('mongoose'); (async()=>{
      const c=await mongoose.createConnection(${JSON.stringify(mongo.getUri())}).asPromise();
      const session=await c.startSession(); session.startTransaction();
      await c.collection(${JSON.stringify(wallets.collection.name)}).updateOne({apiKey:'client'},{$inc:{balance:-10}},{session});
      await c.collection(${JSON.stringify(ledger.collection.name)}).insertOne({apiKey:'client',type:'debit',amount:10},{session});
      await c.collection(${JSON.stringify(bills.collection.name)}).insertOne({taskId:'crash',status:'settled'},{session});
      process.send('writes-complete'); setInterval(()=>{},1000);
    })().catch(e=>{process.send({error:e.message});process.exit(1)});`;
    const child = spawn(process.execPath, ['-e', code], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child write timeout')), 15000);
        child.once('message', message => { clearTimeout(timer); message === 'writes-complete' ? resolve() : reject(new Error(JSON.stringify(message))); });
        child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('child failed')); });
      });
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
      expect(await wallet.getBalance('client')).toMatchObject({ balance: 100, frozenAmount: 0 });
      expect(await ledger.countDocuments()).toBe(0); expect(await bills.countDocuments()).toBe(0);
    } finally { if (child.exitCode === null) child.kill(); }
  }, 25000);
});

it('fails closed on standalone Mongo without changing a wallet', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
  const db = await createConnection(mongo.getUri()).asPromise();
  try {
    const wallets = db.model('Wallet', WalletSchema), ledger = db.model('WalletTransaction', WalletTransactionSchema);
    await wallets.create({ apiKey: 'test', balance: 100 });
    const wallet = new WalletService(wallets as any, ledger as any, {} as any, new EventEmitter2(), {} as any);
    await expect(wallet.credit('test', 5, 'test')).rejects.toThrow();
    expect((await wallets.findOne({ apiKey: 'test' }))?.balance).toBe(100);
    expect(await ledger.countDocuments()).toBe(0);
  } finally { await db.close(); await mongo.stop(); }
}, 60000);
