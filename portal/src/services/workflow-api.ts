import portalApi from './auth-api';
import type { WorkflowNodeData } from '../store/workflow-store';

interface Envelope<T> { code: number; message?: string; data: T }
interface WorkflowDefinition extends Record<string, unknown> {
  _id: string; id?: string; name: string;
  viewport?: { x: number; y: number; zoom: number };
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: WorkflowNodeData }>;
  edges: Array<{ id: string; source: { nodeId: string; port: string }; target: { nodeId: string; port: string }; label?: string; branchId?: string }>;
}
interface WorkflowRun {
  runId: string; workflowId: string; status: string; createdAt?: string;
  nodeStates?: Array<{ nodeId: string; status: string; output?: Record<string, unknown>; error?: { message?: string } }>;
}
interface PortSchema { inputPorts: Array<{ name: string; displayName?: string; dataType: string }>; outputPorts: Array<{ name: string; displayName?: string; dataType: string }> }

export const workflowApi = {
  list: (params?: Record<string, unknown>) => portalApi.get('/workflows', { params }),
  get: (id: string) => portalApi.get<unknown, Envelope<WorkflowDefinition>>(`/workflows/${id}`),
  create: (data: Record<string, unknown>) => portalApi.post<unknown, Envelope<WorkflowDefinition>>('/workflows', data),
  update: (id: string, data: Record<string, unknown>) => portalApi.put<unknown, Envelope<WorkflowDefinition>>(`/workflows/${id}`, data),
  delete: (id: string) => portalApi.delete(`/workflows/${id}`),
  validate: (data: Record<string, unknown>) => portalApi.post<unknown, Envelope<{ valid: boolean; errors?: Array<{ message: string; nodeId?: string; edgeId?: string }> }>>('/workflows/validate', data),
  run: (id: string, input: Record<string, unknown>) => portalApi.post<unknown, Envelope<{ runId: string }>>(`/workflows/${id}/run`, input),
  runNode: (workflowId: string, nodeId: string, input?: Record<string, unknown>) =>
    portalApi.post<unknown, Envelope<{ runId: string }>>(`/workflows/${workflowId}/nodes/${nodeId}/run`, input || {}),
  getRun: (runId: string, signal?: AbortSignal) => portalApi.get<unknown, Envelope<WorkflowRun>>(`/workflows/runs/${runId}`, { signal }),
  listRuns: (id: string, params: { page: number; pageSize: number; status?: string }, signal?: AbortSignal) =>
    portalApi.get<unknown, Envelope<{ items: WorkflowRun[]; total: number; page: number; pageSize: number }>>(`/workflows/${id}/runs`, { params, signal }),
  cancelRun: (runId: string) => portalApi.post(`/workflows/runs/${runId}/cancel`),
  retryRun: (runId: string, nodeIds?: string[]) =>
    portalApi.post(`/workflows/runs/${runId}/retry`, { nodeIds }),
  getNodeDetail: (runId: string, nodeId: string) =>
    portalApi.get(`/workflows/runs/${runId}/nodes/${nodeId}`),
  getModelPortSchema: (modelId: string) =>
    portalApi.get<unknown, Envelope<PortSchema>>(`/workflows/models/${encodeURIComponent(modelId)}/port-schema`),
};

export const templateApi = {
  list: (params?: Record<string, unknown>) => portalApi.get('/workflow-templates', { params }),
  createFromTemplate: (templateId: string) =>
    portalApi.post(`/workflows/from-template/${templateId}`),
};

export default portalApi;
