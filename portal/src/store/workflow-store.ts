import { create } from 'zustand';
import { Node, Edge } from 'reactflow';
import { NodeType } from '../types/node-types';

/** 工作流节点数据 */
export interface WorkflowNodeData {
  label: string;
  type: NodeType;
  modelId?: string;
  parameters?: Record<string, any>;
  conditions?: Array<{ expression: string; branchId: string }>;
  loopConfig?: {
    inputArray: string;
    outputMode: 'collect' | 'last';
    parallelism: 'sequential' | 'parallel';
    maxConcurrency?: number;
  };
  transform?: { expression: string };
  executionStatus?: 'idle' | 'running' | 'success' | 'error';
  progress?: number;
  output?: Record<string, any>;
}

/** 工作流状态 */
interface WorkflowState {
  /** 工作流 ID */
  workflowId: string | null;
  /** 工作流名称 */
  name: string;
  /** 节点列表 */
  nodes: Node<WorkflowNodeData>[];
  /** 连线列表 */
  edges: Edge[];
  /** 选中的节点 ID */
  selectedNodeId: string | null;
  /** 是否正在执行 */
  isExecuting: boolean;
  /** 执行 ID */
  runId: string | null;
  /** 节点执行状态 */
  nodeStatus: Record<string, 'pending' | 'running' | 'succeeded' | 'failed'>;

  // Actions
  setWorkflowId: (id: string | null) => void;
  setName: (name: string) => void;
  setNodes: (nodes: Node<WorkflowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  addNode: (node: Node<WorkflowNodeData>) => void;
  updateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (edgeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setIsExecuting: (isExecuting: boolean) => void;
  setRunId: (runId: string | null) => void;
  setNodeStatus: (nodeId: string, status: 'pending' | 'running' | 'succeeded' | 'failed') => void;
  reset: () => void;
}

const initialState = {
  workflowId: null,
  name: 'Untitled Workflow',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isExecuting: false,
  runId: null,
  nodeStatus: {},
};

export const useWorkflowStore = create<WorkflowState>((set) => ({
  ...initialState,

  setWorkflowId: (id) => set({ workflowId: id }),
  setName: (name) => set({ name }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  updateNode: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node,
      ),
    })),

  removeNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    })),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, edge],
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
    })),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  setRunId: (runId) => set({ runId }),
  setNodeStatus: (nodeId, status) =>
    set((state) => ({
      nodeStatus: { ...state.nodeStatus, [nodeId]: status },
    })),

  reset: () => set(initialState),
}));
