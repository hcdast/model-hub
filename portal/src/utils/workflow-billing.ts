import { isAxiosError } from 'axios';

export function needsWorkflowApiKey(error: unknown): boolean {
  if (!isAxiosError<{ code?: number; message?: string }>(error) || error.response?.status !== 400) return false;
  const { code, message } = error.response.data || {};
  // Support the older server response during rolling upgrades.
  return code === 1009 || (code === 1001 && message === 'Create an enabled Portal API Key before running model nodes');
}

export function workflowReturnPath(value: string | null): string | null {
  return value && (/^\/workflows\/[a-f\d]{24}$/i.test(value) || /^\/short-dramas\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) ? value : null;
}
