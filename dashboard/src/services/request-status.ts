import { useSyncExternalStore } from 'react';
type State = { failures: Record<string, { message: string; lastSuccess?: string }>; lastSuccess: Record<string, string> };
let state: State = { failures: {}, lastSuccess: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
export function reportRequest(config: any, error?: any) {
  if (config?.method !== 'get') return;
  const key = String(config.url || '');
  if (error) state = { ...state, failures: { ...state.failures, [key]: { message: error?.response?.data?.message || error?.message || '网络异常', lastSuccess: state.lastSuccess[key] } } };
  else { const failures = { ...state.failures }; delete failures[key]; state = { failures, lastSuccess: { ...state.lastSuccess, [key]: new Date().toISOString() } }; }
  emit();
}
export const clearRequestFailures = () => { state = { ...state, failures: {} }; emit(); };
export function useRequestStatus() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state); }
