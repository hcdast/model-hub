import { TaskService } from './task.service';
import { FeatureQueueProcessor } from '../queue/feature-queue.processor';
import { TaskStatus } from '../common/constants/task-status';

describe('Disabled supplier submission boundary', () => {
  it('rejects a new task before billing or queueing when the selected supplier is disabled', async () => {
    const service: any = Object.create(TaskService.prototype);
    const cfg = { model_id: 'demo/text-to-image', model_type: 'textToImage', provider: 'wavespeed-ai' };
    Object.assign(service, {
      logger: { log: jest.fn() },
      providerRouting: { tryResolveFromRules: async () => null }, providerRegistry: { hasAdapter: () => true },
      modelConfigModel: { find: () => ({ sort: () => ({ lean: async () => [cfg] }) }) },
      providerConfig: { getResolved: async () => ({ enabled: false }) },
      billingAdapter: { initBilling: jest.fn() }, queueRouter: { enqueue: jest.fn() },
    });
    await expect(service.createTask('test-client', { model: cfg.model_id, input: {}, options: { featureType: 'textToImage' } })).rejects.toThrow('供应商已停用');
    expect(service.billingAdapter.initBilling).not.toHaveBeenCalled();
    expect(service.queueRouter.enqueue).not.toHaveBeenCalled();
  });

  it('fails and refunds a queued pending task without calling an adapter after the supplier is disabled', async () => {
    const processor: any = Object.create(FeatureQueueProcessor.prototype);
    const adapter = { submitTask: jest.fn() };
    Object.assign(processor, {
      logger: { log: jest.fn() }, timingService: { recordTiming: jest.fn() }, timelineService: { addEvent: jest.fn() },
      taskRepo: { findByTaskId: async () => ({ taskId: 'queued-task', status: TaskStatus.PENDING, model: 'demo/model', apiKey: 'test', createdAt: new Date() }), updateStatus: jest.fn().mockResolvedValue({}) },
      providerRegistry: { getAdapter: () => adapter }, providerConfig: { getResolved: async () => ({ enabled: false }) },
      billingAdapter: { refund: jest.fn() }, metrics: { taskFailedTotal: { inc: jest.fn() } }, eventEmitter: { emit: jest.fn() },
      usageTracker: { recordCompletion: jest.fn().mockResolvedValue(undefined) }, resourceMetadataEnqueue: { scheduleForTask: jest.fn().mockResolvedValue(undefined) },
    });
    await processor.submitToProvider({ id: 'job', attemptsMade: 0, data: { taskId: 'queued-task', provider: 'wavespeed-ai', featureType: 'image_generate' }, queue: { name: 'image-generate:wavespeed-ai' } });
    expect(adapter.submitTask).not.toHaveBeenCalled();
    expect(processor.taskRepo.updateStatus).toHaveBeenCalledWith('queued-task', TaskStatus.PENDING, TaskStatus.FAILED, { error: expect.objectContaining({ code: 'PROVIDER_DISABLED' }) });
    expect(processor.billingAdapter.refund).toHaveBeenCalledWith({ taskId: 'queued-task', reason: 'provider_disabled' });
  });
});
