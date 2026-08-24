/*
 * 执行图接口定义
 */
import { WorkflowNode } from '../../database/schemas/workflow.schema';

/**
 * 端口定义
 */
export interface PortDefinition {
  /** 端口名称 */
  name: string;
  /** 端口显示名称 */
  displayName?: string;
  /** 数据类型 */
  dataType: string;
  /** 是否必需 */
  required?: boolean;
  /** 默认值 */
  defaultValue?: any;
  /** 描述 */
  description?: string;
}

/**
 * 图节点
 */
export interface GraphNode {
  /** 节点 ID */
  id: string;
  /** 节点类型 */
  type: WorkflowNode['type'];
  /** 上游节点 ID 列表 */
  dependencies: string[];
  /** 下游节点 ID 列表 */
  dependents: string[];
  /** 输入端口定义 */
  inputPorts: PortDefinition[];
  /** 输出端口定义 */
  outputPorts: PortDefinition[];
  /** 原始节点数据 */
  data?: WorkflowNode['data'];
}

/**
 * 图边
 */
export interface GraphEdge {
  /** 边 ID */
  id: string;
  /** 源节点 ID */
  sourceNodeId: string;
  /** 源端口名称 */
  sourcePort: string;
  /** 目标节点 ID */
  targetNodeId: string;
  /** 目标端口名称 */
  targetPort: string;
  /** 分支 ID（条件分支） */
  branchId?: string;
}

/**
 * 执行图（DAG）
 */
export interface ExecutionGraph {
  /** 节点映射（节点 ID -> GraphNode） */
  nodes: Map<string, GraphNode>;
  /** 边列表 */
  edges: GraphEdge[];
  /** 入口节点（无依赖） */
  entryNodes: string[];
  /** 出口节点（无下游） */
  exitNodes: string[];
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** 工作流输入 */
  input: Record<string, any>;
  /** 节点输出映射（节点 ID -> 输出数据） */
  nodeOutputs: Map<string, Record<string, any>>;
}

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否合法 */
  valid: boolean;
  /** 执行顺序（按层级） */
  executionOrder?: string[][];
  /** 错误列表 */
  errors?: Array<{
    nodeId?: string;
    edgeId?: string;
    portName?: string;
    message: string;
  }>;
  /** 警告列表 */
  warnings?: Array<{
    nodeId?: string;
    message: string;
  }>;
}
