import portalApi from './auth-api';

export interface WorkflowAsset {
  id: string;
  name: string;
  url: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  text?: string;
  mimeType?: string;
  size?: number;
  source?: 'upload' | 'output-reference' | 'output-text';
}
interface Envelope<T> { code: number; message: string; data: T }
export interface AssetPage { items: WorkflowAsset[]; total: number; page: number; pageSize: number }

export const workflowAssetsApi = {
  list: (page = 1, pageSize = 20) => portalApi.get<never, Envelope<AssetPage>>('/workflow-assets', { params: { page, pageSize } }),
  upload: (file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return portalApi.post<never, Envelope<WorkflowAsset>>('/workflow-assets', form, {
      timeout: 120000,
      onUploadProgress: event => { if (event.total) onProgress?.(Math.round(event.loaded * 100 / event.total)); },
    });
  },
  fromOutput: (data: { workflowId: string; runId: string; nodeId: string; name?: string }) =>
    portalApi.post<never, Envelope<WorkflowAsset>>('/workflow-assets/from-output', data, { timeout: 120000 }),
  delete: (id: string) => portalApi.delete<never, Envelope<{ id: string; storageObjectDeleted: boolean }>>(`/workflow-assets/${encodeURIComponent(id)}`),
};
