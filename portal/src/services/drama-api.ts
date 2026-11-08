import portalApi from './auth-api';
import type { DramaProject, DramaPlan, DramaKind, DramaQuote, DramaCandidate } from '../../../src/short-drama/drama.types';
import type { ParamDocItem } from '../types/model-params';
import type { DramaTimingReport } from '../../../src/short-drama/drama-timing';
import type { DramaVisualReport } from '../../../src/short-drama/drama-visual';
import type { CaptionReport } from '../../../src/short-drama/drama-captions';
export type { DramaProject, DramaPlan, DramaKind, DramaQuote, DramaCandidate };
export interface DramaModel { configId: string; modelId: string; name: string; type: string; provider?: string; kinds: DramaKind[]; params: ParamDocItem[] }
export interface DramaVoice { id: string; name: string; preview?: string; locale?: string; language?: string; model: string }
export interface DramaCapabilities { mp4: boolean; subtitles: boolean; reason: string; generationEnabled?: boolean; createEnabled?: boolean; exportEnabled?: boolean }
interface Envelope<T> { code: number; data: T; message?: string }
async function unwrap<T>(request: Promise<Envelope<T>>): Promise<T> { const r = await request; if (r.code !== 0) throw new Error(r.message || '请求失败'); return r.data; }
export const dramaApi = {
  templates: () => unwrap(portalApi.get<never, Envelope<Array<{ id: string; version: number; name: string; description: string; shotCount: number; generatedMedia: boolean; missing: string[] }>>>('/short-dramas/templates')),
  fromTemplate: (id: string) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/templates/${encodeURIComponent(id)}/create`)),
  list: (page = 1, archived = false, search = '') => unwrap(portalApi.get<never, Envelope<{ items: DramaProject[]; total: number; pageSize: number }>>('/short-dramas', { params: { page, archived: String(archived), search } })),
  create: (plan?: DramaPlan) => unwrap(portalApi.post<never, Envelope<DramaProject>>('/short-dramas', { plan })),
  get: (id: string) => unwrap(portalApi.get<never, Envelope<DramaProject>>(`/short-dramas/${encodeURIComponent(id)}`)),
  save: (id: string, revision: number, plan: DramaPlan) => unwrap(portalApi.put<never, Envelope<DramaProject>>(`/short-dramas/${encodeURIComponent(id)}`, { revision, plan })),
  models: () => unwrap(portalApi.get<never, Envelope<DramaModel[]>>('/short-dramas/models')),
  voices: (configId: string, page = 1) => unwrap(portalApi.get<never, Envelope<{ items: DramaVoice[]; page: number; hasMore: boolean }>>('/short-dramas/voices', { params: { configId, page } })),
  capabilities: () => unwrap(portalApi.get<never, Envelope<DramaCapabilities>>('/short-dramas/capabilities')),
  quote: (id: string, kind: DramaKind, targetIds: string[], configId?: string, parameters?: Record<string, unknown>) => unwrap(portalApi.post<never, Envelope<DramaQuote>>(`/short-dramas/${id}/quotes`, { kind, targetIds, configId, parameters })),
  generate: (id: string, quoteId: string) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/${id}/generate`, { quoteId }, { timeout: 120000 })),
  attach: (id: string, kind: DramaKind, targetId: string, assetId: string) => unwrap(portalApi.post<never, Envelope<DramaCandidate>>(`/short-dramas/${id}/assets`, { kind, targetId, assetId })),
  cancel: (id: string, candidateId: string) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/${id}/candidates/${candidateId}/cancel`)),
  export: (id: string, revision: number, requestId: string) => unwrap(portalApi.post<never, Envelope<{ id: string }>>(`/short-dramas/${id}/exports`, { revision, requestId })),
  voiceTiming: (id: string, revision: number) => unwrap(portalApi.post<never, Envelope<DramaTimingReport>>(`/short-dramas/${id}/voice-timing`, { revision }, { timeout: 90000 })),
  mediaCheck: (id: string, revision: number) => unwrap(portalApi.post<never, Envelope<DramaVisualReport>>(`/short-dramas/${id}/media-check`, { revision }, { timeout: 90000 })),
  captionTiming: (id: string, revision: number) => unwrap(portalApi.post<never, Envelope<CaptionReport>>(`/short-dramas/${id}/caption-timing`, { revision }, { timeout: 90000 })),
  media: (id: string, candidate: string) => portalApi.get<never, Blob>(`/short-dramas/${id}/candidates/${candidate}/media`, { responseType: 'blob', timeout: 90000 }),
  budget: (id: string, revision: number, limit: number) => unwrap(portalApi.put<never, Envelope<DramaProject>>(`/short-dramas/${id}/budget`, { revision, limit })),
  copy: (id: string) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/${id}/copy`)),
  retryArchives: (id: string) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/${id}/archive-retry`)),
  archive: (id: string, revision: number, archived: boolean) => unwrap(portalApi.put<never, Envelope<DramaProject>>(`/short-dramas/${id}/archive`, { revision, archived })),
  restore: (id: string, revision: number, target: number) => unwrap(portalApi.post<never, Envelope<DramaProject>>(`/short-dramas/${id}/restore`, { revision, target })),
};
