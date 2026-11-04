import axios from 'axios';
export interface PlaygroundTask { taskId: string; status: string; result?: unknown; error?: { message?: string }; billing?: { actualCost?: number; estimatedCost?: number; currency?: string } }
interface Envelope { code: number; message?: string; data: PlaygroundTask }
// The task API requires an explicit API key. Do not persist it or use a session-refresh interceptor.
const client = axios.create({ baseURL: '/api/v1/tasks', timeout: 30000 });
async function unwrap(request: Promise<{ data: Envelope }>) { const { data } = await request; if (data.code !== 0) throw new Error(data.message || '任务请求失败'); return data.data; }
export const playgroundApi = {
  create: (key: string, body: unknown, idempotency: string) => unwrap(client.post('', body, { headers: { 'X-API-Key': key, 'X-Idempotency-Key': idempotency } })),
  get: (key: string, taskId: string, signal?: AbortSignal) => unwrap(client.get(`/${encodeURIComponent(taskId)}`, { signal, headers: { 'X-API-Key': key } })),
  cancel: (key: string, taskId: string) => unwrap(client.post(`/${encodeURIComponent(taskId)}/cancel`, {}, { headers: { 'X-API-Key': key } })),
};
