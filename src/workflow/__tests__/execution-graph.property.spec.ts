/*
 * 执行图属性测试
 * Feature: workflow-orchestration, Property 1, 2, 4: DAG 无环性、拓扑排序正确性、并行执行安全性
 */
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { Workflow } from '../../database/schemas/workflow.schema';
import * as fc from 'fast-check';

describe('ExecutionGraphResolver Property Tests', () => {
  let resolver: ExecutionGraphResolver;

  beforeEach(() => {
    resolver = new ExecutionGraphResolver();
  });

  /**
   * Property 1: DAG 无环性
   * For any 合法的工作流定义，ExecutionGraphResolver 解析出的执行图必须是无环有向图（DAG）
   */
  describe('Property 1: DAG 无环性', () => {
    it('对于任意合法的 DAG 工作流，解析结果应无环', () => {
      // 生成合法的 DAG 工作流
      const nodeArbitrary = fc.record({
        id: fc.string({ minLength: 1, maxLength: 10 }),
        type: fc.constantFrom('model', 'condition', 'loop', 'input', 'output', 'transform'),
        position: fc.record({
          x: fc.integer(),
          y: fc.integer(),
        }),
        data: fc.record({}),
      });
      const workflowArbitrary = fc
        .record({
          name: fc.string({ minLength: 1, maxLength: 20 }),
          nodes: fc.uniqueArray(nodeArbitrary, {
            minLength: 1,
            maxLength: 10,
            selector: (node) => node.id,
          }),
        })
        .map((workflow) => ({
          ...workflow,
          edges: workflow.nodes.slice(1).map((node, index) => ({
            id: `edge-${index}`,
            source: { nodeId: workflow.nodes[index].id, port: 'output' },
            target: { nodeId: node.id, port: 'input' },
          })),
        }));

      fc.assert(
        fc.property(workflowArbitrary, (workflow) => {
          const graph = resolver.resolve(workflow as unknown as Workflow);

          expect(graph.nodes.size).toBe(workflow.nodes.length);
          expect(resolver.detectCycle(graph)).toBeNull();
        }),
      );
    });

    it('对于包含环的工作流，应能检测到环', () => {
      // 创建一个包含环的工作流：A -> B -> C -> A
      const cyclicWorkflow: any = {
        name: 'cyclic-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
          { id: 'C', type: 'model', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'B', port: 'in' } },
          { id: 'e2', source: { nodeId: 'B', port: 'out' }, target: { nodeId: 'C', port: 'in' } },
          { id: 'e3', source: { nodeId: 'C', port: 'out' }, target: { nodeId: 'A', port: 'in' } },
        ],
      };

      const graph = resolver.resolve(cyclicWorkflow);
      const cycle = resolver.detectCycle(graph);

      expect(cycle).not.toBeNull();
      expect(cycle!.length).toBeGreaterThan(0);
    });

    it('拒绝悬空连线、重复标识和缺失的可执行配置', () => {
      const result = resolver.validate({
        nodes: [
          { id: 'duplicate', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'duplicate', type: 'input', position: { x: 1, y: 1 }, data: {} },
        ],
        edges: [
          {
            id: 'edge',
            source: { nodeId: 'missing', port: 'output' },
            target: { nodeId: 'duplicate', port: 'input' },
          },
        ],
      } as Workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: '模型节点缺少 modelId' }),
          expect.objectContaining({ message: '节点 ID 重复: duplicate' }),
          expect.objectContaining({ message: '源节点不存在: missing' }),
        ]),
      );
    });
  });

  /**
   * Property 2: 拓扑排序正确性
   * For any 执行图，拓扑排序结果必须保证：对于任意边 (u, v)，u 的执行层级 < v 的执行层级
   */
  describe('Property 2: 拓扑排序正确性', () => {
    it('拓扑排序结果应保证依赖顺序正确', () => {
      // 创建一个简单的 DAG 工作流
      const workflow: any = {
        name: 'test-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
          { id: 'C', type: 'model', position: { x: 200, y: 0 }, data: {} },
          { id: 'D', type: 'model', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'B', port: 'in' } },
          { id: 'e2', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'C', port: 'in' } },
          { id: 'e3', source: { nodeId: 'B', port: 'out' }, target: { nodeId: 'D', port: 'in' } },
          { id: 'e4', source: { nodeId: 'C', port: 'out' }, target: { nodeId: 'D', port: 'in' } },
        ],
      };

      const graph = resolver.resolve(workflow);
      const executionOrder = resolver.topologicalSort(graph);

      // 构建节点到层级的映射
      const levelMap = new Map<string, number>();
      executionOrder.forEach((level, levelIndex) => {
        level.forEach((nodeId) => {
          levelMap.set(nodeId, levelIndex);
        });
      });

      // 验证每条边 (source, target) 满足 source.level < target.level
      for (const edge of graph.edges) {
        const sourceLevel = levelMap.get(edge.sourceNodeId);
        const targetLevel = levelMap.get(edge.targetNodeId);

        expect(sourceLevel).toBeDefined();
        expect(targetLevel).toBeDefined();
        expect(sourceLevel!).toBeLessThan(targetLevel!);
      }
    });

    it('同一层级的节点应可并行执行（无依赖关系）', () => {
      const workflow: any = {
        name: 'parallel-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
          { id: 'C', type: 'model', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'B', port: 'in' } },
          { id: 'e2', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'C', port: 'in' } },
        ],
      };

      const graph = resolver.resolve(workflow);
      const executionOrder = resolver.topologicalSort(graph);

      // B 和 C 应在同一层级
      expect(executionOrder.length).toBe(2);
      expect(executionOrder[0]).toContain('A');
      expect(executionOrder[1]).toEqual(expect.arrayContaining(['B', 'C']));
    });
  });

  /**
   * Property 4: 并行执行安全性
   * For any 并行执行的节点集合，这些节点之间必须没有数据依赖关系
   */
  describe('Property 4: 并行执行安全性', () => {
    it('可并行执行的节点之间应无依赖关系', () => {
      const workflow: any = {
        name: 'parallel-safety-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
          { id: 'C', type: 'model', position: { x: 200, y: 0 }, data: {} },
          { id: 'D', type: 'model', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'B', port: 'in' } },
          { id: 'e2', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'C', port: 'in' } },
          { id: 'e3', source: { nodeId: 'B', port: 'out' }, target: { nodeId: 'D', port: 'in' } },
          { id: 'e4', source: { nodeId: 'C', port: 'out' }, target: { nodeId: 'D', port: 'in' } },
        ],
      };

      const graph = resolver.resolve(workflow);
      const completedNodes = new Set<string>(['A']);
      const parallelNodes = resolver.getParallelNodes(graph, completedNodes);

      // B 和 C 可以并行
      expect(parallelNodes).toEqual(expect.arrayContaining(['B', 'C']));

      // 验证 B 和 C 之间没有依赖关系
      const nodeB = graph.nodes.get('B');
      const nodeC = graph.nodes.get('C');

      expect(nodeB!.dependencies).not.toContain('C');
      expect(nodeC!.dependencies).not.toContain('B');
    });

    it('有依赖关系的节点不应同时被标记为可并行', () => {
      const workflow: any = {
        name: 'dependency-workflow',
        nodes: [
          { id: 'A', type: 'model', position: { x: 0, y: 0 }, data: {} },
          { id: 'B', type: 'model', position: { x: 100, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'B', port: 'in' } },
        ],
      };

      const graph = resolver.resolve(workflow);

      // 当 A 未完成时，B 不应可执行
      const completedNodes1 = new Set<string>();
      const parallelNodes1 = resolver.getParallelNodes(graph, completedNodes1);
      expect(parallelNodes1).toContain('A');
      expect(parallelNodes1).not.toContain('B');

      // 当 A 完成后，B 才可执行
      const completedNodes2 = new Set<string>(['A']);
      const parallelNodes2 = resolver.getParallelNodes(graph, completedNodes2);
      expect(parallelNodes2).toContain('B');
    });
  });
});
