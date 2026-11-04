import portalApi from './auth-api';

export interface PortalNotification {
  id: string;
  type: 'workflow_run' | 'drama_result';
  status: 'succeeded' | 'failed' | 'cancelled';
  workflowName: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}
export interface NotificationPage {
  items: PortalNotification[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}
interface Envelope<T> { code: number; data: T }
export const notificationApi = {
  list: (page: number, unreadOnly: boolean, signal: AbortSignal) =>
    portalApi.get<unknown, Envelope<NotificationPage>>('/notifications', { params: { page, pageSize: 8, unreadOnly }, signal }),
  count: (signal: AbortSignal) => portalApi.get<unknown, Envelope<{ count: number }>>('/notifications/unread-count', { signal }),
  read: (id: string) => portalApi.put<unknown, Envelope<{ count: number }>>(`/notifications/${encodeURIComponent(id)}/read`),
  readAll: () => portalApi.put<unknown, Envelope<{ count: number }>>('/notifications/read-all'),
};
