import { Logger } from '@nestjs/common';
import { PollingService } from './polling.service';
import { TaskStatus } from '../common/constants/task-status';

describe('MaaS cancelled terminal state', () => {
  function fixture() {
    const service: any = Object.create(PollingService.prototype);
    Object.assign(service, {
      logger: new Logger('test'), providerRegistry: { getAdapter: () => ({ queryTask: async () => ({ status: 'cancelled' }) }) },
      providerConfig: { getPollLimitsSync: () => ({ maxPerSecond: 1 }) }, rateLimiter: { acquire: async () => true },
      timelineService: { addEvent: jest.fn() }, collectHealthMetrics: jest.fn(),
      billingAdapter: { refund: jest.fn().mockResolvedValue(undefined) },
      taskRepo: { updateStatus: jest.fn().mockResolvedValue({}), incrementPollCount: jest.fn() },
      usageTracker: { recordCompletion: jest.fn().mockResolvedValue(undefined) }, resourceMetadataEnqueue: { scheduleForTask: jest.fn().mockResolvedValue(undefined) },
      config: { polling: { maxPollCount: 100, maxDurationMs: 100000 } },
    });
    const task = { taskId: 'task', apiKey: 'local-test', provider: 'akool-maas', status: TaskStatus.SUBMITTED, createdAt: new Date(), providerTask: { providerTaskId: 'upstream' } };
    return { service, task };
  }
  it('refunds and stops polling instead of treating cancellation as unknown', async () => {
    const { service, task } = fixture(); await service.pollSingleTask(task);
    expect(service.billingAdapter.refund).toHaveBeenCalledWith({ taskId: 'task', reason: 'provider_cancelled' });
    expect(service.taskRepo.updateStatus).toHaveBeenCalledWith('task', [TaskStatus.SUBMITTED, TaskStatus.PROCESSING], TaskStatus.CANCELLED);
    expect(service.taskRepo.incrementPollCount).not.toHaveBeenCalled();
  });
  it('does not finalize when the refund operation throws', async () => {
    const { service, task } = fixture(); service.billingAdapter.refund.mockRejectedValue(new Error('billing unavailable'));
    await expect(service.pollSingleTask(task)).rejects.toThrow('billing unavailable');
    expect(service.taskRepo.updateStatus).not.toHaveBeenCalled();
  });
});
