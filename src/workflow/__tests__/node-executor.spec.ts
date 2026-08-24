/*
 * 节点执行器单元测试
 * Feature: workflow-orchestration
 */
import { NodeExecutor, NodeExecutionJob } from '../node.executor';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { SafeExpressionService } from '../safe-expression.service';
import { TaskService } from '../../task/task.service';

describe('NodeExecutor', () => {
  let executor: NodeExecutor;
  let executionService: jest.Mocked<WorkflowExecutionService>;
  let taskService: jest.Mocked<TaskService>;

  beforeEach(() => {
    executionService = {
      onNodeComplete: jest.fn(),
      onNodeFailed: jest.fn(),
      onNodeTaskCreated: jest.fn(),
    } as unknown as jest.Mocked<WorkflowExecutionService>;
    taskService = {
      createTask: jest.fn().mockResolvedValue({ taskId: 'task-1' }),
      getTask: jest.fn().mockResolvedValue({
        taskId: 'task-1',
        status: 'SUCCESS',
        result: ['https://example.com/output.png'],
      }),
    } as unknown as jest.Mocked<TaskService>;

    executor = new NodeExecutor(
      executionService,
      new SafeExpressionService(),
      taskService,
    );
  });

  describe('executeModelNode', () => {
    it('应成功执行模型节点', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-1',
        nodeId: 'node-1',
        nodeType: 'model',
        nodeData: {
          modelId: 'test-model',
          parameters: { prompt: 'test prompt' },
        },
        input: { negative_prompt: 'test negative' },
        context: {
          input: {},
          nodeOutputs: {},
        },
        apiKey: 'mh_test_secret',
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-1',
        'node-1',
        expect.objectContaining({
          result: ['https://example.com/output.png'],
        }),
      );
    });

    it('模型节点缺少 modelId 应失败', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-2',
        nodeId: 'node-2',
        nodeType: 'model',
        nodeData: {},
        input: {},
        context: {
          input: {},
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeFailed).toHaveBeenCalledWith(
        'test-run-2',
        'node-2',
        expect.objectContaining({
          code: 'NODE_EXECUTION_FAILED',
        }),
      );
    });
  });

  describe('executeConditionNode', () => {
    it('应正确评估条件并返回匹配的分支', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-3',
        nodeId: 'node-3',
        nodeType: 'condition',
        nodeData: {
          conditions: [
            { expression: '$input.value > 10', branchId: 'branch-a' },
            { expression: '$input.value <= 10', branchId: 'branch-b' },
          ],
        },
        input: { value: 15 },
        context: {
          input: { value: 15 },
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-3',
        'node-3',
        expect.objectContaining({
          branchId: 'branch-a',
        }),
      );
    });

    it('无匹配条件应返回默认分支', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-4',
        nodeId: 'node-4',
        nodeType: 'condition',
        nodeData: {
          conditions: [
            { expression: '$input.value > 100', branchId: 'branch-a' },
          ],
        },
        input: { value: 50 },
        context: {
          input: { value: 50 },
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-4',
        'node-4',
        expect.objectContaining({
          branchId: 'default',
        }),
      );
    });
  });

  describe('executeLoopNode', () => {
    it('应正确执行循环节点', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-5',
        nodeId: 'node-5',
        nodeType: 'loop',
        nodeData: {
          loopConfig: {
            inputArray: '$input.items',
            outputMode: 'collect',
            parallelism: 'sequential',
          },
        },
        input: { items: [1, 2, 3] },
        context: {
          input: { items: [1, 2, 3] },
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-5',
        'node-5',
        expect.objectContaining({
          results: [1, 2, 3],
        }),
      );
    });

    it('循环输入不是数组应失败', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-6',
        nodeId: 'node-6',
        nodeType: 'loop',
        nodeData: {
          loopConfig: {
            inputArray: '$input.notArray',
            outputMode: 'collect',
            parallelism: 'sequential',
          },
        },
        input: { notArray: 'string' },
        context: {
          input: { notArray: 'string' },
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeFailed).toHaveBeenCalledWith(
        'test-run-6',
        'node-6',
        expect.objectContaining({
          code: 'NODE_EXECUTION_FAILED',
        }),
      );
    });
  });

  describe('executeTransformNode', () => {
    it('应正确执行转换节点', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-7',
        nodeId: 'node-7',
        nodeType: 'transform',
        nodeData: {
          transform: {
            expression: '$input.value * 2',
          },
        },
        input: { value: 5 },
        context: {
          input: {},
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-7',
        'node-7',
        { value: 10 },
      );
    });
  });

  describe('executeInputNode', () => {
    it('应返回工作流输入', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-8',
        nodeId: 'node-8',
        nodeType: 'input',
        nodeData: {},
        input: {},
        context: {
          input: { prompt: 'test prompt', seed: 123 },
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-8',
        'node-8',
        { prompt: 'test prompt', seed: 123 },
      );
    });
  });

  describe('executeOutputNode', () => {
    it('应返回节点输入', async () => {
      const job: NodeExecutionJob = {
        runId: 'test-run-9',
        nodeId: 'node-9',
        nodeType: 'output',
        nodeData: {},
        input: { result: 'final result' },
        context: {
          input: {},
          nodeOutputs: {},
        },
      };

      await executor.execute({ data: job } as any);

      expect(executionService.onNodeComplete).toHaveBeenCalledWith(
        'test-run-9',
        'node-9',
        { result: 'final result' },
      );
    });
  });
});
