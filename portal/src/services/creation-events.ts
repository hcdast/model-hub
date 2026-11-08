import axios from 'axios';
import portalApi from './auth-api';

let fallbackSession = '';
function sessionId() {
  try { const old = sessionStorage.getItem('creation-event-session'); if (old) return old; const id = crypto.randomUUID(); sessionStorage.setItem('creation-event-session', id); return id; }
  catch { return fallbackSession ||= crypto.randomUUID(); }
}
/** Telemetry is best effort and never blocks creation or saves. */
export function templateEvent(name: 'template_view' | 'create_click', kind: 'workflow' | 'short-drama', templateId: string) {
  try { void axios.post('/api/v1/creation-events/public', { name, kind, templateId, sessionId: sessionId() }, { timeout: 5000 }).catch(() => {}); } catch { /* Storage/crypto restrictions must not block the action. */ }
}
export function projectEvent(name: 'quote_viewed' | 'take_selected' | 'download_started', projectId: string, referenceId: string) {
  void portalApi.post('/creation-events', { name, projectId, referenceId }, { timeout: 5000 }).catch(() => {});
}
