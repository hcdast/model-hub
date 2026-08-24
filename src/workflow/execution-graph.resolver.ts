/*
 * 执行图解析器
 * 将工作流定义解析为可执行的 DAG
 */
import { Injectable, Logger } from '@nestjs/common';
import { Workflow, WorkflowNode, WorkflowEdge } from '../database/schemas/workflow.schema';
import {
  ExecutionGraph,
  GraphNode,
  GraphEdge,
  ExecutionContext,
  ValidationResult,
  PortDefinition,
} from './interfaces/execution-graph.interface';

/**
 * 执行图解析器
 * 负责将工作流定义解析为 DAG，并提供拓扑排序、环检测等功能
 */
@Injectable()
export class ExecutionGraphResolver {
  private readonly logger = new Logger(ExecutionGraphResolver.name);

  /**
   * 解析工作流为执行图（DAG）
   * @param workflow 工作流定义
   * @returns 执行图
   */
  resolve(workflow: Workflow): ExecutionGraph {
    this.logger.debug(`解析工作流: ${String(Reflect.get(Object(workflow), '_id') ?? 'new')}`);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const entryNodes: string[] = [];
    const exitNodes: string[] = [];

    // 1. 构建节点映射
    for (const node of workflow.nodes) {
      const graphNode: GraphNode = {
        id: node.id,
        type: node.type,
        dependencies: [],
        dependents: [],
        inputPorts: [],
        outputPorts: [],
        data: node.data,
      };
      nodes.set(node.id, graphNode);
    }

    // 2. 构建边列表，建立依赖关系
    for (const edge of workflow.edges || []) {
      const graphEdge: GraphEdge = {
        id: edge.id,
        sourceNodeId: edge.source.nodeId,
        sourcePort: edge.source.port,
        targetNodeId: edge.target.nodeId,
        targetPort: edge.target.port,
        branchId: edge.branchId,
      };
      edges.push(graphEdge);

      // 更新依赖关系
      const sourceNode = nodes.get(graphEdge.sourceNodeId);
      const targetNode = nodes.get(graphEdge.targetNodeId);

      if (sourceNode && targetNode) {
        // 目标节点依赖源节点
        if (!targetNode.dependencies.includes(graphEdge.sourceNodeId)) {
          targetNode.dependencies.push(graphEdge.sourceNodeId);
        }
        // 源节点的下游包含目标节点
        if (!sourceNode.dependents.includes(graphEdge.targetNodeId)) {
          sourceNode.dependents.push(graphEdge.targetNodeId);
        }
      }
    }

    // 3. 找出入口节点（无依赖）和出口节点（无下游）
    for (const [nodeId, node] of nodes) {
      if (node.dependencies.length === 0) {
        entryNodes.push(nodeId);
      }
      if (node.dependents.length === 0) {
        exitNodes.push(nodeId);
      }
    }

    this.logger.debug(
      `解析完成: ${nodes.size} 个节点, ${edges.length} 条边, 入口节点: ${entryNodes.join(',')}`,
    );

    return {
      nodes,
      edges,
      entryNodes,
      exitNodes,
    };
  }

  /**
   * 拓扑排序，返回执行层级
   * @param graph 执行图
   * @returns 执行层级（每层可并行执行的节点）
   */
  topologicalSort(graph: ExecutionGraph): string[][] {
    this.logger.debug('开始拓扑排序');

    const result: string[][] = [];
    const inDegree = new Map<string, number>();
    const visited = new Set<string>();

    // 初始化入度
    for (const [nodeId, node] of graph.nodes) {
      inDegree.set(nodeId, node.dependencies.length);
    }

    // 使用 Kahn 算法进行拓扑排序
    let currentLevel = [...graph.entryNodes];

    while (currentLevel.length > 0) {
      // 当前层的节点可以并行执行
      result.push([...currentLevel]);

      const nextLevel: string[] = [];

      for (const nodeId of currentLevel) {
        visited.add(nodeId);
        const node = graph.nodes.get(nodeId);

        if (node) {
          // 减少下游节点的入度
          for (const dependentId of node.dependents) {
            const degree = inDegree.get(dependentId) || 0;
            inDegree.set(dependentId, degree - 1);

            // 如果入度为 0 且未访问，加入下一层
            if (degree - 1 === 0 && !visited.has(dependentId)) {
              nextLevel.push(dependentId);
            }
          }
        }
      }

      currentLevel = nextLevel;
    }

    this.logger.debug(`拓扑排序完成: ${result.length} 个层级`);
    return result;
  }

  /**
   * 检测环
   * @param graph 执行图
   * @returns 如果存在环，返回环路径；否则返回 null
   */
  detectCycle(graph: ExecutionGraph): string[] | null {
    this.logger.debug('开始环检测');

    const WHITE = 0; // 未访问
    const GRAY = 1;  // 正在访问
    const BLACK = 2; // 已完成

    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();

    // 初始化颜色
    for (const nodeId of graph.nodes.keys()) {
      color.set(nodeId, WHITE);
    }

    // DFS 检测环
    const dfs = (nodeId: string): string[] | null => {
      color.set(nodeId, GRAY);

      const node = graph.nodes.get(nodeId);
      if (node) {
        for (const dependentId of node.dependents) {
          const dependentColor = color.get(dependentId);

          if (dependentColor === GRAY) {
            // 发现环，构建环路径
            const cycle: string[] = [dependentId, nodeId];
            let current = nodeId;

            while (parent.get(current)) {
              const p = parent.get(current)!;
              cycle.push(p);
              if (p === dependentId) break;
              current = p;
            }

            return cycle.reverse();
          }

          if (dependentColor === WHITE) {
            parent.set(dependentId, nodeId);
            const result = dfs(dependentId);
            if (result) return result;
          }
        }
      }

      color.set(nodeId, BLACK);
      return null;
    };

    // 先从入口节点开始，再覆盖无入口的连通分量（纯环图没有入口节点）。
    const roots = [
      ...graph.entryNodes,
      ...[...graph.nodes.keys()].filter(
        (nodeId) => !graph.entryNodes.includes(nodeId),
      ),
    ];
    for (const nodeId of roots) {
      if (color.get(nodeId) !== WHITE) continue;
      parent.set(nodeId, null);
      const result = dfs(nodeId);
      if (result) {
        this.logger.warn(`检测到环: ${result.join(' -> ')}`);
        return result;
      }
    }

    this.logger.debug('环检测完成: 无环');
    return null;
  }

  /**
   * 获取可并行执行的节点
   * @param graph 执行图
   * @param completedNodes 已完成的节点集合
   * @returns 可执行的节点 ID 列表
   */
  getParallelNodes(graph: ExecutionGraph, completedNodes: Set<string>): string[] {
    const result: string[] = [];

    for (const [nodeId, node] of graph.nodes) {
      // 跳过已完成的节点
      if (completedNodes.has(nodeId)) {
        continue;
      }

      // 检查所有依赖是否都已完成
      const allDependenciesCompleted = node.dependencies.every((depId) =>
        completedNodes.has(depId),
      );

      if (allDependenciesCompleted) {
        result.push(nodeId);
      }
    }

    return result;
  }

  /**
   * 解析节点输入（从上游节点输出解析）
   * @param nodeId 节点 ID
   * @param graph 执行图
   * @param context 执行上下文
   * @returns 解析后的输入值
   */
  resolveNodeInput(
    nodeId: string,
    graph: ExecutionGraph,
    context: ExecutionContext,
  ): Record<string, any> {
    const result: Record<string, any> = {};
    const node = graph.nodes.get(nodeId);

    if (!node) {
      return result;
    }

    // 找到所有指向当前节点的边
    const incomingEdges = graph.edges.filter((edge) => edge.targetNodeId === nodeId);

    for (const edge of incomingEdges) {
      const sourceOutput = context.nodeOutputs.get(edge.sourceNodeId);

      if (sourceOutput) {
        // 从源节点输出中获取对应端口的值
        result[edge.targetPort] = sourceOutput[edge.sourcePort];
      }
    }

    return result;
  }

  /**
   * 校验工作流定义
   * @param workflow 工作流定义
   * @returns 校验结果
   */
  validate(workflow: Workflow): ValidationResult {
    this.logger.debug(
      `校验工作流: ${String(Reflect.get(Object(workflow), '_id') ?? 'new')}`,
    );

    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];
    const nodeIds = new Set<string>();
    for (const node of workflow.nodes) {
      if (nodeIds.has(node.id)) {
        errors.push({ nodeId: node.id, message: `节点 ID 重复: ${node.id}` });
      }
      nodeIds.add(node.id);
      const modelBacked = ![
        'condition',
        'loop',
        'input',
        'output',
        'transform',
      ].includes(node.type);
      if (modelBacked && !node.data?.modelId) {
        errors.push({ nodeId: node.id, message: '模型节点缺少 modelId' });
      } else if (node.type === 'condition' && !node.data?.conditions?.length) {
        errors.push({ nodeId: node.id, message: '条件节点缺少 conditions' });
      } else if (node.type === 'loop' && !node.data?.loopConfig) {
        errors.push({ nodeId: node.id, message: '循环节点缺少 loopConfig' });
      } else if (node.type === 'transform' && !node.data?.transform?.expression) {
        errors.push({ nodeId: node.id, message: '转换节点缺少 expression' });
      }
    }
    const edgeIds = new Set<string>();
    for (const edge of workflow.edges ?? []) {
      if (edgeIds.has(edge.id)) {
        errors.push({ edgeId: edge.id, message: `连线 ID 重复: ${edge.id}` });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source.nodeId)) {
        errors.push({
          edgeId: edge.id,
          message: `源节点不存在: ${edge.source.nodeId}`,
        });
      }
      if (!nodeIds.has(edge.target.nodeId)) {
        errors.push({
          edgeId: edge.id,
          message: `目标节点不存在: ${edge.target.nodeId}`,
        });
      }
    }

    const graph = this.resolve(workflow);

    const cycle = this.detectCycle(graph);
    if (cycle) {
      errors.push({
        message: `检测到环: ${cycle.join(' -> ')}`,
      });
      return { valid: false, errors };
    }

    // 5. 警告：未连接的可选端口
    for (const [nodeId, node] of graph.nodes) {
      if (node.dependencies.length === 0 && !graph.entryNodes.includes(nodeId)) {
        warnings.push({
          nodeId,
          message: '节点没有上游依赖，可能未连接',
        });
      }
    }

    // 6. 生成执行顺序
    const executionOrder = this.topologicalSort(graph);

    this.logger.debug(`校验完成: valid=${errors.length === 0}`);

    return {
      valid: errors.length === 0,
      executionOrder,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
