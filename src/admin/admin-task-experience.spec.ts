import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Schema } from 'mongoose';
import { AdminTaskController } from './admin-task.controller';
import { StatsService } from '../stats/stats.service';
import { taskRepairGuidance } from '../common/utils/task-repair-guidance';

describe('Task investigation and billing display with isolated MongoDB', () => {
  let mongo: MongoMemoryServer, db: Connection, tasks: any, bills: any, controller: AdminTaskController;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    db = await createConnection(mongo.getUri()).asPromise();
    tasks = db.model('tasks', new Schema({}, { strict: false }));
    bills = db.model('billing_records', new Schema({}, { strict: false }));
    const clients = db.model('api_clients', new Schema({}, { strict: false }));
    controller = Object.create(AdminTaskController.prototype);
    Object.assign(controller, { taskModel: tasks, billingModel: bills, apiClientModel: clients,
      queueRegistry: { getQueue: () => undefined }, taskService: { canCancel: () => false },
      resourceMetadataEnqueue: { scheduleForTask: async () => undefined } });
    const task = (taskId: string, status: string, extra = {}) => ({ taskId, status, provider: 'supplier-a', model: 'tts-model', featureType: 'tts', apiKey: 'fixture-only', createdAt: new Date('2026-11-04T12:00:00Z'), updatedAt: new Date('2026-11-04T12:00:00Z'), ...extra });
    await tasks.insertMany([
      ...Array.from({ length: 125 }, (_, i) => task(`failed-${i}`, 'FAILED', { error: { code: 'HTTP_502' } })),
      task('timed-out', 'TIMEOUT', { provider: 'supplier-b' }),
      task('provider-error', 'FAILED', { error: { providerCode: 'PROVIDER_CODE' } }),
      task('dollar-code', 'FAILED', { error: { code: '$ERROR' } }),
      task('success', 'SUCCESS'), task('cancelled', 'CANCELLED'),
      task('older', 'FAILED', { createdAt: new Date('2026-10-01'), error: { code: 'HTTP_502' } }),
    ]);
    await bills.create({ taskId: 'failed-0', status: 'refunded', billingPolicy: 'internal', usageType: 'count', estimatedUsage: 22, actualUsage: 0, estimatedCost: 0.22, actualCost: 0, unitPrice: 0.01, pricingSnapshot: { revision: 1, pricing: { usage_measure: 'characters' }, unit_price_map: {} } });
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });

  it('aggregates beyond one task page and excludes successes/cancellations', async () => {
    const result = await controller.failureSummary({ from: '2026-11-04T00:00:00Z', to: '2026-11-05T00:00:00Z' });
    expect(result.data.total).toBe(128);
    expect(result.data.items[0]).toMatchObject({ provider: 'supplier-a', model: 'tts-model', errorCode: 'HTTP_502', count: 125 });
    expect(result.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ errorCode: 'UNKNOWN', count: 1 }), expect.objectContaining({ errorCode: 'PROVIDER_CODE', count: 1 })]));
  });
  it('uses identical error filters for aggregation and drilldown, including literal $ codes', async () => {
    for (const code of ['HTTP_502', 'PROVIDER_CODE', 'UNKNOWN', '$ERROR']) {
      const summary = await controller.failureSummary({ errorCode: code, failureOnly: '1' });
      const list = await controller.listTasks(undefined, undefined, undefined, undefined, '1', '20', undefined, undefined, undefined, undefined, undefined, code, '1');
      expect(list.data.total).toBe(summary.data.total);
      expect(summary.data.items).toHaveLength(1);
    }
    await expect(controller.failureSummary({ from: 'invalid-date' })).rejects.toThrow('日期');
  });
  it('returns recorded character billing and a final refunded diagnosis without a repair action', async () => {
    const detail: any = await controller.getTask('failed-0');
    expect(detail.data.billing).toMatchObject({ usageType: 'count', usageMeasure: 'characters', estimatedUsage: 22, status: 'refunded' });
    const diagnosis = await controller.diagnostics('failed-0');
    expect(diagnosis.data).toMatchObject({ canReconcileFailure: false, billing: { status: 'refunded', billingPolicy: 'internal' } });
    expect(diagnosis.data?.recommendation).toContain('无需重复修复');
  });
  it('includes timeout and cancellation counts in full-range trends', async () => {
    const stats: StatsService = Object.create(StatsService.prototype);
    Object.assign(stats, { taskModel: tasks });
    const result = await stats.queryDaily({ dateFrom: '2026-11-04', dateTo: '2026-11-04' }, 1, 1);
    expect(result.trend[0]).toMatchObject({ totalCount: 130, successCount: 1, timeoutCount: 1, cancelledCount: 1 });
    expect(result.items).toHaveLength(1);
  });
});

describe('Failure repair guidance', () => {
  it.each(['SUCCESS', 'CANCELLED'])('never offers failure repair for %s', status => {
    expect(taskRepairGuidance(status, { status: 'pre_deducted', billingPolicy: 'internal' }).canReconcileFailure).toBe(false);
  });
  it.each(['refunded', 'settled', 'failed'])('does not offer repeated refunds or bypass accounting for %s bills', status => {
    expect(taskRepairGuidance('FAILED', { status, billingPolicy: 'internal' }).canReconcileFailure).toBe(false);
  });
  it('offers terminal repair only for an outstanding internal reservation', () => {
    expect(taskRepairGuidance('FAILED', { status: 'pre_deducted', billingPolicy: 'internal' }).canReconcileFailure).toBe(true);
    expect(taskRepairGuidance('FAILED', { status: 'estimated', billingPolicy: 'external' }).canReconcileFailure).toBe(false);
    expect(taskRepairGuidance('PROCESSING', null).recommendation).toContain('队列缺失不代表供应商失败');
  });
});
