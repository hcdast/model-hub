import axios from 'axios';
import type { TemplateActivityMetrics } from './template-metrics';

export interface DramaTemplateSummary {
  metrics?: TemplateActivityMetrics;
  id: string; version: number; name: string; description: string; kind: 'short-drama';
  source: 'official' | 'community'; shotCount: number; generatedMedia: false; ratio: string;
}
export interface DramaTemplateDetail extends DramaTemplateSummary {
  instructions?: string;
  story: string;
  characters: Array<{ name: string; description: string }>;
  shots: Array<{ title: string; description: string; narration: string; duration: number }>;
}
// Public browsing must not attempt to refresh a visitor's session.
const client = axios.create({ baseURL: '/api/v1/catalog/drama-templates', timeout: 15000 });
async function unwrap<T>(request: Promise<{ data: { code: number; data: T; message?: string } }>): Promise<T> {
  const { data } = await request;
  if (data.code !== 0) throw new Error(data.message || 'Template request failed');
  return data.data;
}
export const dramaTemplateCatalogApi = {
  list: (search: string, page: number, signal?: AbortSignal, order = 'recommended', source = '') => unwrap<{ items: DramaTemplateSummary[]; total: number; page: number; pageSize: number }>(client.get('', { params: { search, page, pageSize: 12, order, ...(source ? { source } : {}) }, signal })),
  detail: (id: string, signal?: AbortSignal) => unwrap<DramaTemplateDetail>(client.get(`/${encodeURIComponent(id)}`, { signal })),
};
