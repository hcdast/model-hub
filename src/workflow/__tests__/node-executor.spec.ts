/*
 * 节点执行器单元测试
 * Feature: workflow-orchestration
 */
import { NodeExecutor, NodeExecutionJob } from '../node.executor';
import { WorkflowExecutionService } from '../workflow-execution.service';
import { SafeExpressionService } from '../safe-expression.service';
import { TaskService } from '../../task/task.service';
import { assignPortInput, readOutputPort } from '../workflow-ports';

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
    it('passes the shared project authorization into the real task creation boundary', async () => {
      const budget = { createTask: jest.fn(async (_job, create) => create({ maxCharge: 2.5, budgetId: 'trusted-budget', input: { prompt: 'validated' }, configId: '507f1f77bcf86cd799439011', configRevision: 3, featureType: 'textToImage' })) };
      executor = new NodeExecutor(executionService, new SafeExpressionService(), taskService, budget as any);
      await executor.execute({ data: { runId: 'run', nodeId: 'node', attempt: 2, nodeType: 'model', apiKey: 'isolated-key', nodeData: { modelId: 'fixture', parameters: { prompt: 'original' } }, input: {}, context: { input: {}, nodeOutputs: {} } } } as any);
      expect(taskService.createTask).toHaveBeenCalledWith('isolated-key', expect.objectContaining({ input: { prompt: 'validated' }, options: { configId: '507f1f77bcf86cd799439011', configRevision: 3, featureType: 'textToImage' }, metadata: { workflowBudgetId: 'trusted-budget', workflowRunId: 'run', workflowNodeId: 'node' } }), 'workflow:run:node:2', { maxCharge: 2.5 });
    });

    it('does not bypass a rejected project budget when executing a model node', async () => {
      executor = new NodeExecutor(executionService, new SafeExpressionService(), taskService, { createTask: jest.fn().mockRejectedValue(new Error('项目剩余预算不足')) } as any);
      await executor.execute({ data: { runId: 'run', nodeId: 'node', nodeType: 'model', apiKey: 'isolated-key', nodeData: { modelId: 'fixture' }, input: {}, context: { input: {}, nodeOutputs: {} } } } as any);
      expect(taskService.createTask).not.toHaveBeenCalled();
      expect(executionService.onNodeFailed).toHaveBeenCalledWith('run', 'node', expect.objectContaining({ message: '项目剩余预算不足' }));
    });

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
          image: 'https://example.com/output.png',
          output: ['https://example.com/output.png'],
          json: ['https://example.com/output.png'],
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

    it('rejects object prompts before creating billable tasks', async () => {
      // execute reads only job.data; Bull lifecycle methods are not needed for this unit boundary.
      const job = { data: {
        runId: 'run', nodeId: 'n', nodeType: 'model', apiKey: 'billing-key',
        nodeData: { modelId: 'm', parameters: { prompt: { text: 'not a string' } } },
        input: {}, context: { input: {}, nodeOutputs: {} },
      } } as unknown as Parameters<NodeExecutor['execute']>[0];
      await executor.execute(job);
      expect(taskService.createTask).not.toHaveBeenCalled();
      expect(executionService.onNodeFailed).toHaveBeenCalledWith('run', 'n', expect.objectContaining({ message: '模型 prompt 参数必须是纯文本' }));
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
    it.each([
      { value: 7, other: 1 },
      { result: 'x', other: 1 },
      { output: 'x', other: 1 },
      { value: 7 },
      { results: [1, 2] },
    ])('roundtrips last-loop business object %j through its output aliases', async (lastItem) => {
      const nodeData: NodeExecutionJob['nodeData'] = { loopConfig: {
        inputArray: '$input.items', outputMode: 'last', parallelism: 'sequential',
      } };
      const data: NodeExecutionJob = {
        runId: 'last-run', nodeId: 'loop', nodeType: 'loop', nodeData,
        input: { items: [lastItem] }, context: { input: {}, nodeOutputs: {} },
      };
      // The execute method consumes only data at this Bull unit boundary.
      const job = { data } as unknown as Parameters<NodeExecutor['execute']>[0];
      await executor.execute(job);
      expect(executionService.onNodeFailed).not.toHaveBeenCalled();
      const output = executionService.onNodeComplete.mock.calls[0][2];
      const node = { type: 'loop' as const, data: nodeData };
      expect(readOutputPort(node, output, 'result')).toEqual(lastItem);
      expect(readOutputPort(node, output, 'output')).toEqual(lastItem);
      expect(() => readOutputPort(node, output, 'missing')).toThrow('缺少输出端口');
    });

    it.each([
      { lastItem: 0, expected: 0 },
      { lastItem: false, expected: false },
      { lastItem: 'last', expected: 'last' },
      { lastItem: '', expected: '' },
      { lastItem: null, expected: null },
      { lastItem: [1, 2], expected: [1, 2] },
      { lastItem: [], expected: [] },
      { lastItem: { value: 7, other: 1 }, expected: 7 },
      { lastItem: { value: null }, expected: null },
      { lastItem: { value: false }, expected: false },
      { lastItem: { value: 0 }, expected: 0 },
      { lastItem: { value: '', result: 'business result', output: 'business output' }, expected: '' },
    ])('delivers last-loop value $lastItem to a downstream node', async ({ lastItem, expected }) => {
      const nodeData: NodeExecutionJob['nodeData'] = { loopConfig: {
        inputArray: '$input.items', outputMode: 'last', parallelism: 'sequential',
      } };
      const data: NodeExecutionJob = {
        runId: 'last-run', nodeId: 'loop', nodeType: 'loop', nodeData,
        input: { items: [lastItem] }, context: { input: {}, nodeOutputs: {} },
      };
      await executor.execute({ data } as Parameters<NodeExecutor['execute']>[0]);
      expect(executionService.onNodeFailed).not.toHaveBeenCalled();
      const output = executionService.onNodeComplete.mock.calls[0][2];
      const node = { type: 'loop' as const, data: nodeData };
      const input: Record<string, unknown> = {};
      assignPortInput(input, { type: 'output' }, 'value', readOutputPort(node, output, 'value'));
      await executor.execute({ data: {
        runId: 'last-run', nodeId: 'downstream', nodeType: 'output', nodeData: {},
        input, context: { input: {}, nodeOutputs: {} },
      } } as Parameters<NodeExecutor['execute']>[0]);
      expect(executionService.onNodeComplete).toHaveBeenLastCalledWith('last-run', 'downstream', { value: expected });
      expect(executionService.onNodeFailed).not.toHaveBeenCalled();
      expect(taskService.createTask).not.toHaveBeenCalled();
      expect(readOutputPort(node, output, 'result')).toEqual(lastItem);
      expect(readOutputPort(node, output, 'output')).toEqual(lastItem);
      for (const port of ['missing', '__proto__', 'constructor', 'prototype']) {
        expect(() => readOutputPort(node, output, port)).toThrow();
      }
    });

    it.each([
      { items: [] },
      { items: [undefined] },
      { items: [{ value: undefined }] },
      { items: [{}] },
      { items: [{ result: 'business result', output: 'business output' }] },
      { items: [Object.create({ value: 'inherited' })] },
    ])('rejects absent last-loop value from $items', async ({ items }) => {
      const nodeData: NodeExecutionJob['nodeData'] = { loopConfig: {
        inputArray: '$input.items', outputMode: 'last', parallelism: 'sequential',
      } };
      const data: NodeExecutionJob = {
        runId: 'last-run', nodeId: 'loop', nodeType: 'loop', nodeData,
        input: { items }, context: { input: {}, nodeOutputs: {} },
      };
      await executor.execute({ data } as Parameters<NodeExecutor['execute']>[0]);
      expect(executionService.onNodeFailed).not.toHaveBeenCalled();
      const output = executionService.onNodeComplete.mock.calls[0][2];
      const node = { type: 'loop' as const, data: nodeData };
      expect(readOutputPort(node, output, 'result')).toBe(items.at(-1));
      expect(readOutputPort(node, output, 'output')).toBe(items.at(-1));
      expect(() => readOutputPort(node, output, 'value')).toThrow('缺少输出端口');
      if (items.length === 0 || items[0] === undefined) {
        for (const port of ['result', 'output']) {
          expect(() => assignPortInput({}, { type: 'output' }, 'value', readOutputPort(node, output, port))).toThrow('缺少值');
        }
      }
    });

    it.each([
      { value: 0 },
      { value: false },
      { value: '' },
      { value: null },
      { value: [] },
      { value: { nested: 'business value' } },
    ])(
      'preserves unversioned last-loop value wrappers for %j',
      ({ value }) => {
        const node = { type: 'loop' as const, data: { loopConfig: {
          inputArray: '$input.items', outputMode: 'last' as const, parallelism: 'sequential' as const,
        } } };
        const legacyOutput = { value };
        for (const port of ['value', 'result', 'output']) {
          const input: Record<string, unknown> = {};
          assignPortInput(input, { type: 'output' }, 'value', readOutputPort(node, legacyOutput, port));
          expect(input.value).toBe(value);
        }
        for (const port of ['missing', '__proto__', 'constructor', 'prototype']) {
          expect(() => readOutputPort(node, legacyOutput, port)).toThrow();
        }
      },
    );

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
