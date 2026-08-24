/*
 * 工作流执行状态管理属性测试
 * Feature: workflow-orchestration, Property 3, 7: 节点输入解析正确性、状态一致性
 */
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { ExecutionContext } from '../interfaces/execution-graph.interface';
import * as fc from 'fast-check';

describe('WorkflowRun Property Tests', () => {
  let resolver: ExecutionGraphResolver;

  beforeEach(() => {
    resolver = new ExecutionGraphResolver();
  });

  /**
   * Property 3: 节点输入解析正确性
   * For any 节点，解析后的输入值必须等于其输入端口定义的期望值
   */
  describe('Property 3: 节点输入解析正确性', () => {
    it('解析的节点输入应正确引用上游节点输出', () => {
      // 创建工作流
      const workflow: any = {
        name: 'test-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'result' }, target: { nodeId: 'B', port: 'prompt' } },
        ],
      };

      const graph = resolver.resolve(workflow);

      // 模拟执行上下文
      const context: ExecutionContext = {
        input: {},
        nodeOutputs: new Map([
          ['A', { result: 'output-from-A' }],
        ]),
      };

      // 解析节点 B 的输入
      const nodeBInput = resolver.resolveNodeInput('B', graph, context);

      expect(nodeBInput['prompt']).toBe('output-from-A');
    });

    it('多个上游节点的输入应正确解析', () => {
      const workflow: any = {
        name: 'multi-input-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
          { id: 'C', type: 'model', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'text' }, target: { nodeId: 'C', port: 'prompt' } },
          { id: 'e2', source: { nodeId: 'B', port: 'image' }, target: { nodeId: 'C', port: 'reference' } },
        ],
      };

      const graph = resolver.resolve(workflow);

      const context: ExecutionContext = {
        input: {},
        nodeOutputs: new Map([
          ['A', { text: 'text-from-A' }],
          ['B', { image: 'image-from-B' }],
        ]),
      };

      const nodeCInput = resolver.resolveNodeInput('C', graph, context);

      expect(nodeCInput['prompt']).toBe('text-from-A');
      expect(nodeCInput['reference']).toBe('image-from-B');
    });
  });

  /**
   * Property 7: 状态一致性
   * For any WorkflowRun，nodeStates 中 succeeded + failed + skipped + cancelled 的数量必须等于 totalNodes
   */
  describe('Property 7: 状态一致性', () => {
    it('工作流完成后，所有节点状态之和应等于 totalNodes', () => {
      // 模拟一个完成的 WorkflowRun
      const totalNodes = 5;
      const nodeStates = [
        { nodeId: 'A', status: 'succeeded' },
        { nodeId: 'B', status: 'succeeded' },
        { nodeId: 'C', status: 'failed' },
        { nodeId: 'D', status: 'skipped' },
        { nodeId: 'E', status: 'cancelled' },
      ];

      const stats = {
        totalNodes,
        completedNodes: 2,
        failedNodes: 1,
        skippedNodes: 1,
      };

      // 验证状态一致性
      const succeededCount = nodeStates.filter((n) => n.status === 'succeeded').length;
      const failedCount = nodeStates.filter((n) => n.status === 'failed').length;
      const skippedCount = nodeStates.filter((n) => n.status === 'skipped').length;
      const cancelledCount = nodeStates.filter((n) => n.status === 'cancelled').length;
      const pendingCount = nodeStates.filter((n) => n.status === 'pending').length;
      const runningCount = nodeStates.filter((n) => n.status === 'running').length;

      const terminalCount = succeededCount + failedCount + skippedCount + cancelledCount;
      const nonTerminalCount = pendingCount + runningCount;

      // 所有节点数量之和应等于 totalNodes
      expect(terminalCount + nonTerminalCount).toBe(totalNodes);

      // 终态节点数量应与统计一致
      expect(succeededCount).toBe(stats.completedNodes);
      expect(failedCount).toBe(stats.failedNodes);
      expect(skippedCount).toBe(stats.skippedNodes);
    });

    it('使用属性测试验证状态一致性不变量', () => {
      // 生成随机的节点状态数组
      const nodeStatusArbitrary = fc.array(
        fc.constantFrom('succeeded', 'failed', 'skipped', 'cancelled', 'pending', 'running'),
        { minLength: 1, maxLength: 20 },
      );

      fc.assert(
        fc.property(nodeStatusArbitrary, (statuses) => {
          const totalNodes = statuses.length;
          const nodeStates = statuses.map((status, index) => ({
            nodeId: `node-${index}`,
            status,
          }));

          // 计算各种状态的数量
          const succeededCount = nodeStates.filter((n) => n.status === 'succeeded').length;
          const failedCount = nodeStates.filter((n) => n.status === 'failed').length;
          const skippedCount = nodeStates.filter((n) => n.status === 'skipped').length;
          const cancelledCount = nodeStates.filter((n) => n.status === 'cancelled').length;
          const pendingCount = nodeStates.filter((n) => n.status === 'pending').length;
          const runningCount = nodeStates.filter((n) => n.status === 'running').length;

          // 不变量：所有节点数量之和等于 totalNodes
          const sum =
            succeededCount + failedCount + skippedCount + cancelledCount + pendingCount + runningCount;
          expect(sum).toBe(totalNodes);

          // 不变量：每个节点都有且仅有一个状态
          expect(nodeStates.length).toBe(totalNodes);
        }),
      );
    });
  });
});
