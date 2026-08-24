import portalApi from './auth-api';

export const workflowApi = {
  list: (params?: Record<string, unknown>) => portalApi.get('/workflows', { params }),
  get: (id: string) => portalApi.get(`/workflows/${id}`),
  create: (data: Record<string, unknown>) => portalApi.post('/workflows', data),
  update: (id: string, data: Record<string, unknown>) => portalApi.put(`/workflows/${id}`, data),
  delete: (id: string) => portalApi.delete(`/workflows/${id}`),
  validate: (data: Record<string, unknown>) => portalApi.post('/workflows/validate', data),
  run: (id: string, input: Record<string, unknown>) => portalApi.post(`/workflows/${id}/run`, input),
  runNode: (workflowId: string, nodeId: string, input?: Record<string, unknown>) =>
    portalApi.post(`/workflows/${workflowId}/nodes/${nodeId}/run`, input || {}),
  getRun: (runId: string) => portalApi.get(`/workflows/runs/${runId}`),
  cancelRun: (runId: string) => portalApi.post(`/workflows/runs/${runId}/cancel`),
  retryRun: (runId: string, nodeIds?: string[]) =>
    portalApi.post(`/workflows/runs/${runId}/retry`, { nodeIds }),
  getNodeDetail: (runId: string, nodeId: string) =>
    portalApi.get(`/workflows/runs/${runId}/nodes/${nodeId}`),
  getModelPortSchema: (modelId: string) =>
    portalApi.get(`/workflows/models/${modelId}/port-schema`),
};

export const templateApi = {
  list: (params?: Record<string, unknown>) => portalApi.get('/workflow-templates', { params }),
  createFromTemplate: (templateId: string) =>
    portalApi.post(`/workflows/from-template/${templateId}`),
};

export default portalApi;
