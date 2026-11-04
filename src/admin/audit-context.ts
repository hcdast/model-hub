import { AsyncLocalStorage } from 'async_hooks';
export const auditContext = new AsyncLocalStorage<{ correlationId: string }>();
