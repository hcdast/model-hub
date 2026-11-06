import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import Redis from 'ioredis';
import Bull = require('bull');
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { createServer as createHttpServer } from 'http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection } from 'mongoose';
import { NotificationModule } from '../notification/notification.module';
import { SystemEventsModule } from '../notification/events/system-events.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationListener } from '../notification/listeners/notification.listener';
import { NotificationService } from '../notification/services/notification.service';
import { RuleMatcherService } from '../notification/services/rule-matcher.service';
import { NotificationRateLimiterService } from '../notification/services/notification-rate-limiter.service';
import { NotificationProcessor } from '../notification/processors/notification.processor';
import { WeComChannel } from '../notification/channels/wecom.channel';
import { NotificationRuleSchema } from '../database/schemas/notification-rule.schema';
import { NotificationRecordSchema } from '../database/schemas/notification-record.schema';
import { CircuitBreakerStore } from './circuit-breaker-store.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitState } from './interfaces/circuit-breaker-state.interface';
import { ProviderRoutingService } from '../task/provider-routing.service';
import { AdminStatsController } from '../admin/admin-stats.controller';

/** Starts its own loopback Redis with persistence disabled; never loads application configuration. */
describe('Isolated Redis routing recovery and queue backlog', () => {
  let process: ChildProcess, folder: string, redis: Redis, port: number;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'model-hub-ops-'));
    const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); port = (server.address() as any).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    process = spawn(global.process.env.REDIS_TEST_SERVER || 'redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no', '--dir', folder], { stdio: 'ignore', windowsHide: true });
    await new Promise<void>((resolve, reject) => { process.once('error', reject); setTimeout(resolve, 300); });
    redis = new Redis({ host: '127.0.0.1', port, retryStrategy: times => times < 15 ? 100 : null, maxRetriesPerRequest: 2 });
    await redis.ping();
  }, 15000);
  afterAll(async () => {
    if (redis) { try { await redis.shutdown('NOSAVE'); } catch {} redis.disconnect(); }
    if (process?.exitCode === null) await new Promise<void>(resolve => { process.once('exit', () => resolve()); process.kill(); });
    if (folder) await rm(folder, { recursive: true, force: true });
  });
  it('atomically admits only the configured count across concurrent limiter instances and expires the window', async () => {
    const a = new NotificationRateLimiterService(redis), b = new NotificationRateLimiterService(redis);
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).checkAndIncrement('concurrent', 'burst', 5000, 7)));
    expect(results.filter(result => !result.suppressed)).toHaveLength(7);
    expect(await redis.zcard('notify:rate:concurrent:burst')).toBe(7);
    expect(await redis.pttl('notify:rate:concurrent:burst')).toBeGreaterThan(0);
    expect((await a.checkAndIncrement('other-rule', 'burst', 5000, 7)).suppressed).toBe(false);
    await a.checkAndIncrement('expired', 'burst', 30, 1);
    expect((await b.checkAndIncrement('expired', 'burst', 30, 1)).suppressed).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await b.checkAndIncrement('expired', 'burst', 30, 1)).suppressed).toBe(false);
    const broken = new NotificationRateLimiterService({ eval: async () => { throw new Error('private redis address'); } } as any);
    await expect(broken.checkAndIncrement('test', 'burst', 1000, 1)).rejects.toThrow('未放行投递');
  });
  it('opens, switches to fallback, probes and recovers to primary with transition events', async () => {
    const store = new CircuitBreakerStore(redis), events = new EventEmitter2(), received: string[] = [];
    for (const name of ['system.provider_circuit_open', 'system.provider_circuit_half_open', 'system.provider_circuit_closed']) events.on(name, () => received.push(name));
    const metric = { labels: () => ({ set: jest.fn(), inc: jest.fn() }) };
    const config = { getConfig: async () => ({ cooldownDurationMs: 10, errorRateThreshold: 50, minSampleCount: 5, consecutiveFailureThreshold: 3, probeRequestCount: 2 }) };
    const collector: any = { cleanExpiredData: jest.fn() };
    const breaker = new CircuitBreakerService(store, config as any, collector, events, { circuitBreakerState: metric, circuitBreakerTransitionsTotal: metric } as any);
    const route: any = { _id: 'route-fixture', model_id: 'fixture', enabled: true, strategy_type: 'primary_fallback', primary_provider: 'primary', fallback_provider: 'backup', primary_weight: 100, fallback_weight: 0 };
    const routing = new ProviderRoutingService({ find: () => ({ lean: () => ({ exec: async () => [route] }) }) } as any, {} as any, breaker, {} as any, { providerFailoverTotal: metric, routingDecisionTotal: metric } as any);
    const resolve = () => routing.tryResolveFromRules('fixture', 'test');
    expect((await resolve())?.provider).toBe('primary');
    const bad: any = { provider: 'primary', sampleCount: 10, errorRate: 0.8 };
    await breaker.evaluate('primary', bad); expect(await breaker.getState('primary')).toBe(CircuitState.OPEN);
    expect(await breaker.allowRequest('primary')).toBe(false); expect((await resolve())?.provider).toBe('backup');
    await new Promise(resolve => setTimeout(resolve, 20)); await breaker.evaluate('primary', bad);
    expect(await breaker.getState('primary')).toBe(CircuitState.HALF_OPEN); expect((await resolve())?.provider).toBe('primary');
    await breaker.recordResult('primary', false); expect((await resolve())?.provider).toBe('backup');
    await new Promise(resolve => setTimeout(resolve, 20)); await breaker.evaluate('primary', bad);
    await breaker.recordResult('primary', true); await breaker.recordResult('primary', true);
    expect(await breaker.getState('primary')).toBe(CircuitState.CLOSED); expect((await resolve())?.provider).toBe('primary');
    expect(received).toContain('system.provider_circuit_open'); expect(received).toContain('system.provider_circuit_half_open'); expect(received).toContain('system.provider_circuit_closed');
    expect(collector.cleanExpiredData).toHaveBeenCalledWith('primary');
    await breaker.manualOverride('primary', CircuitState.OPEN, 'isolated-test', 'fixture', 60);
    await breaker.evaluate('primary', bad); expect((await resolve())?.provider).toBe('backup');
    await breaker.clearOverride('primary'); expect((await breaker.getFullState('primary')).manualOverride).toBeNull();
  });
  it('delivers real circuit transitions through the configured event listener, Mongo rules, Bull and a loopback webhook', async () => {
    const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    const db = await createConnection(mongo.getUri()).asPromise();
    const rules = db.model('NotificationRule', NotificationRuleSchema), records = db.model('NotificationRecord', NotificationRecordSchema);
    const deliveries: string[] = [];
    const webhook = createHttpServer((request, response) => {
      let body = ''; request.on('data', chunk => body += chunk);
      request.on('end', () => { deliveries.push(body); response.setHeader('Content-Type', 'application/json'); response.end('{"errcode":0}'); });
    });
    await new Promise<void>(resolve => webhook.listen(0, '127.0.0.1', resolve));
    const queue = new Bull('isolated-notification-chain', { redis: { host: '127.0.0.1', port } });
    const service = new NotificationService(rules as any, records as any, new RuleMatcherService(), new NotificationRateLimiterService(redis), queue);
    // Use the production event module options, so wildcard configuration regressions fail this test.
    const eventModule = Reflect.getMetadata('imports', NotificationModule).find((entry: any) => entry === SystemEventsModule);
    expect(Reflect.getMetadata('imports', BillingModule)).toContain(eventModule);
    const module = await Test.createTestingModule({ imports: [eventModule], providers: [NotificationListener, { provide: NotificationService, useValue: service }] }).compile();
    const app = module.createNestApplication({ logger: false }); await app.init();
    try {
      await rules.create({ name: 'isolated-circuit', channelType: 'wecom', channelConfig: { webhookUrl: `http://127.0.0.1:${(webhook.address() as any).port}` }, eventTypes: ['provider_circuit_open', 'provider_circuit_half_open', 'provider_circuit_closed'] });
      const processor = new NotificationProcessor(records as any, new WeComChannel(), {} as any, {} as any);
      queue.process('dispatch', job => processor.handleDispatch(job));
      const metric = { labels: () => ({ set: jest.fn(), inc: jest.fn() }) };
      const breaker = new CircuitBreakerService(new CircuitBreakerStore(redis), { getConfig: async () => ({ cooldownDurationMs: 10, errorRateThreshold: 50, minSampleCount: 5, consecutiveFailureThreshold: 3, probeRequestCount: 1 }) } as any, { cleanExpiredData: async () => {} } as any, module.get(EventEmitter2), { circuitBreakerState: metric, circuitBreakerTransitionsTotal: metric } as any);
      const bad: any = { provider: 'notification-chain', sampleCount: 10, errorRate: 0.8 };
      await breaker.evaluate('notification-chain', bad);
      await new Promise(resolve => setTimeout(resolve, 20)); await breaker.evaluate('notification-chain', bad);
      await breaker.recordResult('notification-chain', true);
      const deadline = Date.now() + 10000;
      while (await records.countDocuments({ status: 'success' }) < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const sent = await records.find({ status: 'success' }).lean();
      expect(sent.map(row => row.eventType).sort()).toEqual(['provider_circuit_closed', 'provider_circuit_half_open', 'provider_circuit_open']);
      expect(deliveries).toHaveLength(3); expect(await queue.getFailedCount()).toBe(0);
      // Inject an actual audit-model write failure, using real Mongo/Bull and webhook delivery.
      const originalUpdate = records.updateOne.bind(records);
      let fail = true;
      const update = jest.spyOn(records, 'updateOne').mockImplementation(((filter: any, change: any, options: any) => {
        if (fail && change.$set?.status === 'success') return Promise.reject(new Error('injected audit outage'));
        return originalUpdate(filter, change, options);
      }) as any);
      const rule: any = await rules.findOne().lean();
      const recovery = await queue.add('dispatch', { event: { type: 'provider_circuit_open', severity: 'critical', timestamp: new Date(), payload: { test: 'audit-recovery' } }, ruleId: String(rule._id), ruleName: rule.name, channelType: rule.channelType, channelConfig: rule.channelConfig, recipients: [] }, { attempts: 2, backoff: 20 });
      await expect(recovery.finished()).rejects.toThrow('通知审计记录写入失败');
      const failed = await queue.getJob(recovery.id);
      expect(await failed!.getState()).toBe('failed'); expect(failed!.data.delivery.phase).toBe('receipt');
      expect(deliveries).toHaveLength(4); expect(await records.countDocuments({ status: 'pending' })).toBe(1);
      fail = false; await failed!.retry(); await failed!.finished();
      expect(deliveries).toHaveLength(4); expect(await records.countDocuments({ status: 'success' })).toBe(4);
      expect(await records.countDocuments({ status: 'pending' })).toBe(0); update.mockRestore();

    } finally {
      await app.close(); await queue.close();
      webhook.closeAllConnections(); await new Promise<void>(resolve => webhook.close(() => resolve()));
      await db.close(); await mongo.stop();
    }
  }, 60000);
  it('reads 20 jobs from a real 50,000-job backlog with bounded Redis ranges and payload size', async () => {
    const queue = new Bull('isolated-backlog', { redis: { host: '127.0.0.1', port } });
    const rows: any[] = [];
    try {
      for (const size of [1000, 10000, 50000]) {
        const previous = rows.at(-1)?.backlog || 0;
        for (let start = previous; start < size; start += 1000) await queue.addBulk(Array.from({ length: Math.min(1000, size - start) }, (_, i) => ({ name: 'never-processed', data: { taskId: `test-${start+i}`, model: 'fixture', apiKey: 'fixture-key', secret: 'must-not-return', payload: 'x'.repeat(512) }, opts: { attempts: 1 } })));
        const getJobs = jest.spyOn(queue, 'getJobs');
        const client: any = { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) }, find: () => ({ select: () => ({ lean: async () => [] }) }) };
        const controller = new AdminStatsController({} as any, {} as any, { getQueue: () => queue } as any, {} as any, client);
        const started = performance.now(), before = global.process.memoryUsage().heapUsed;
        const result: any = await controller.getQueueJobs('isolated-backlog', 'waiting', '2', '20');
        const elapsedMs = performance.now() - started, heapDeltaBytes = global.process.memoryUsage().heapUsed - before;
        expect(result.data.total).toBe(size); expect(result.data.items).toHaveLength(20);
        expect(getJobs).toHaveBeenCalledWith(['waiting'], 20, 39); getJobs.mockRestore();
        const serialized = JSON.stringify(result); expect(serialized).not.toContain('must-not-return'); expect(serialized).not.toContain('fixture-key');
        expect(serialized.length).toBeLessThan(30000); expect(elapsedMs).toBeLessThan(5000);
        rows.push({ backlog: size, elapsedMs: Math.round(elapsedMs * 100) / 100, heapDeltaBytes, responseBytes: Buffer.byteLength(serialized), returned: result.data.items.length });
      }
      const output = join(global.process.cwd(), 'output/verification'); await mkdir(output, { recursive: true });
      await writeFile(join(output, 'admin-queue-load.json'), JSON.stringify({ isolatedRedis: true, measuredAt: new Date().toISOString(), rows }, null, 2));
    } finally { await queue.close(); }
  }, 120000);
});
