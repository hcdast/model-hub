import { TaskService } from './task.service';
import { TaskStatus } from '../common/constants/task-status';

describe('MaaS local cancellation boundary', () => {
  function service(status: TaskStatus) {
    const instance: any = Object.create(TaskService.prototype);
    Object.assign(instance, {
      taskRepo: { findByClientAndTaskId: jest.fn().mockResolvedValue({ taskId: 'task', status, provider: 'akool-maas' }), updateStatus: jest.fn().mockResolvedValue(null) },
      providerRegistry: { getAdapter: () => ({ supportsCancellation: false }) },
      logger: { warn: jest.fn(), log: jest.fn() },
    });
    return instance;
  }
  it('rejects cancellation after upstream submission', async () => {
    const instance = service(TaskStatus.SUBMITTED);
    await expect(instance.cancelTask('test', 'task')).rejects.toThrow('不支持取消');
    expect(instance.taskRepo.updateStatus).not.toHaveBeenCalled();
  });
  it('does not cancel a task that changed from pending to submitted during the request', async () => {
    const instance = service(TaskStatus.PENDING);
    await expect(instance.cancelTask('test', 'task')).rejects.toThrow('status changed');
    expect(instance.taskRepo.updateStatus).toHaveBeenCalledWith('task', [TaskStatus.PENDING], TaskStatus.CANCELLED);
  });
});
