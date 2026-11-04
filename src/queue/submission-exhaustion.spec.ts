import { FeatureQueueProcessor } from './feature-queue.processor';
import { TaskStatus } from '../common/constants/task-status';
import { TimelineEvent } from '../task/task-timeline.service';

describe('Submission exhaustion and supplier acceptance', () => {
  let processor: any, task: any, adapter: any;
  const job = (attempt: number) => ({ id: 'job', attemptsMade: attempt, opts: { attempts: 5 }, data: { taskId: 'test-task', provider: 'test', featureType: 'textToImage' }, queue: { name: 'test-queue' } });
  beforeEach(() => {
    processor = Object.create(FeatureQueueProcessor.prototype);
    task = { taskId: 'test-task', status: TaskStatus.PENDING, model: 'test/model', apiKey: 'test-client', createdAt: new Date(), timeline: [] };
    adapter = { getRateLimitConfig: () => ({ maxPerSecond: 10, maxConcurrent: 10 }), submitTask: jest.fn().mockRejectedValue(new Error('supplier unavailable')), mapError: () => ({ code: 'TEST_502', message: 'supplier unavailable', retryable: true }) };
    const fn = () => jest.fn().mockResolvedValue(undefined);
    Object.assign(processor, { logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      taskRepo: { findByTaskId: async () => task, updateStatus: jest.fn(async (_id, from, to) => { if (task.status !== from) return null; task.status = to; return task; }) },
      timingService: { recordTiming: fn() }, timelineService: { addEvent: fn() }, providerRegistry: { getAdapter: () => adapter }, providerConfig: { getResolved: async () => ({ enabled: true }) },
      rateLimiter: { acquire: jest.fn().mockResolvedValue(true), acquireConcurrent: jest.fn().mockResolvedValue('token'), releaseConcurrent: fn() },
      metrics: { providerRequestDuration: { observe: jest.fn() }, taskFailedTotal: { inc: jest.fn() } }, collectHealthMetrics: jest.fn(),
      eventEmitter: { emit: jest.fn() }, billingAdapter: { refund: fn() }, usageTracker: { recordCompletion: fn() }, resourceMetadataEnqueue: { scheduleForTask: fn() }, config: { polling: { defaultIntervalMs: 1000 } },
    });
  });
  it('keeps intermediate failures pending then closes and refunds once on the final attempt', async () => {
    await expect(processor.submitToProvider(job(3))).rejects.toThrow('supplier unavailable');
    expect(task.status).toBe(TaskStatus.PENDING); expect(processor.billingAdapter.refund).not.toHaveBeenCalled();
    await expect(processor.submitToProvider(job(4))).rejects.toThrow('supplier unavailable');
    expect(task.status).toBe(TaskStatus.FAILED); expect(processor.billingAdapter.refund).toHaveBeenCalledTimes(1);
    await processor.submitToProvider(job(4)); expect(processor.billingAdapter.refund).toHaveBeenCalledTimes(1);
  });
  it('closes exhausted local rate limiting without making a supplier request', async () => {
    processor.rateLimiter.acquire.mockResolvedValue(false);
    await expect(processor.submitToProvider(job(4))).rejects.toThrow('Rate limited');
    expect(adapter.submitTask).not.toHaveBeenCalled(); expect(task.status).toBe(TaskStatus.FAILED);
    expect(processor.billingAdapter.refund).toHaveBeenCalledTimes(1);
  });
  it('does not refund when a concurrent state transition wins', async () => {
    processor.taskRepo.updateStatus.mockResolvedValue(null);
    await processor.submitToProvider(job(4)); expect(processor.billingAdapter.refund).not.toHaveBeenCalled();
  });
  it('does not resubmit a pending task with recorded supplier acceptance', async () => {
    task.timeline = [{ event: TimelineEvent.PROVIDER_SUBMIT_OK }];
    await processor.submitToProvider(job(4)); expect(adapter.submitTask).not.toHaveBeenCalled(); expect(processor.billingAdapter.refund).not.toHaveBeenCalled();
  });
  it('does not convert a local post-acceptance failure into a supplier failure or refund', async () => {
    adapter.submitTask.mockResolvedValue({ providerTaskId: 'supplier-job', isSync: false });
    processor.timelineService.addEvent.mockImplementation(async (_id: any, event: any) => { if (event === TimelineEvent.PROVIDER_SUBMIT_OK) throw new Error('database unavailable'); });
    await expect(processor.submitToProvider(job(4))).rejects.toThrow('database unavailable');
    expect(processor.taskRepo.updateStatus).not.toHaveBeenCalled(); expect(processor.billingAdapter.refund).not.toHaveBeenCalled();
  });
});
