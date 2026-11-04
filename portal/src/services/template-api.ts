import axios from 'axios';
import type { Node, Edge } from 'reactflow';

export const templateScenarios = [
  ['ecommerce', 'E-commerce'], ['marketing', 'Marketing & ads'], ['character', 'People & characters'],
  ['video', 'Video production'], ['audio', 'Voice & audio'], ['image', 'Image editing'],
] as const;
export interface TemplateSummary {
  id: string; name: string; description: string; category: string; tags: string[];
  thumbnail?: string; source: 'official' | 'community'; scenario?: string; authorName?: string;
  version: number; createdAt?: string; updatedAt?: string; nodeCount: number; models: string[];
  inputs: Array<{ name: string; type: string; required: boolean }>; outputs: string[];
}
export interface TemplateExample {
  title: string; mediaType: 'image' | 'video' | 'audio'; inputUrl?: string;
  inputMediaType?: 'image' | 'video' | 'audio'; outputUrl: string; description?: string;
}
export interface TemplateDetail extends TemplateSummary {
  instructions: string; examples: TemplateExample[];
  graph: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; label: string; modelId?: string }>; edges: Edge[] };
}
export interface TemplatePage { items: TemplateSummary[]; total: number; page: number; pageSize: number }
interface Envelope<T> { code: number; message?: string; data: T }

// Browsing does not use authenticated interceptors or attempt session refresh.
const client = axios.create({ baseURL: '/api/v1/catalog/workflow-templates', timeout: 15000 });
async function unwrap<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  const { data } = await request;
  if (data.code !== 0) throw new Error(data.message || 'Template request failed');
  return data.data;
}
export const templateCatalogApi = {
  list: (params: Record<string, string | number>, signal?: AbortSignal) => unwrap(client.get<Envelope<TemplatePage>>('', { params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '')), signal })),
  detail: (id: string, signal?: AbortSignal) => unwrap(client.get<Envelope<TemplateDetail>>(`/${encodeURIComponent(id)}`, { signal })),
};
export function templateDate(value: string | undefined, locale: string): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US') : '—';
}
export function templateMediaUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function templateGraphNodes(template: TemplateDetail): Node[] {
  return template.graph.nodes.map(node => ({ id: node.id, position: node.position,
    data: { label: node.label }, type: 'default',
    style: { background: '#1e1e35', color: '#e2e8f0', border: '1px solid #6264b5', borderRadius: 12, padding: 16, width: 190 },
  }));
}
