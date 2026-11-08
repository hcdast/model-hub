import portalApi from './auth-api';
import type { DramaCandidate } from './drama-api';

interface Envelope<T> { code: number; data: T; message?: string }
async function unwrap<T>(request: Promise<Envelope<T>>) { const result = await request; if (result.code !== 0) throw new Error(result.message || '请求失败'); return result.data; }
export interface TemplateSubmission { _id: string; kind: 'workflow' | 'short-drama'; sourceId: string; name: string; description: string; status: string; reviewNote: string; createdAt: string }
export interface ShotWorkflowLink { id: string; projectId: string; shotId: string; kind: 'image' | 'video'; sourceRevision: number; workflowId: string }
export const creationApi = {
  submit: (input: { kind: 'workflow' | 'short-drama'; sourceId: string; name: string; description: string; instructions: string }) => unwrap(portalApi.post<never, Envelope<TemplateSubmission>>('/creation-templates/submissions', input)),
  submissions: (page = 1) => unwrap(portalApi.get<never, Envelope<{ items: TemplateSubmission[]; total: number }>>('/creation-templates/submissions', { params: { page } })),
  createShotWorkflow: (input: { projectId: string; shotId: string; kind: 'image' | 'video'; revision: number; templateId?: string }) => unwrap(portalApi.post<never, Envelope<ShotWorkflowLink>>('/drama-workflows', input)),
  shotWorkflow: (id: string) => unwrap(portalApi.get<never, Envelope<ShotWorkflowLink | null>>(`/drama-workflows/by-workflow/${encodeURIComponent(id)}`)),
  importShotOutput: (id: string, runId: string, nodeId: string) => unwrap(portalApi.post<never, Envelope<{ projectId: string; candidate: DramaCandidate }>>(`/drama-workflows/${encodeURIComponent(id)}/import`, { runId, nodeId })),
};
