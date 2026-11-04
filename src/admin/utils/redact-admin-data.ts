/** Redact known credential fields before returning diagnostic data to read-only administrators. */
export function redactAdminData(value: any, key = '', depth = 0): any {
  if (depth > 20) return '[TRUNCATED]';
  if (/^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|smtpPass|plainKey|oldPassword|newPassword|passwordHash|secretHash|x-modelhub-signature|signature)$/i.test(key)) return value ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map(v => redactAdminData(v, '', depth + 1));
  if (value instanceof Date || value?._bsontype) return value;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactAdminData(v, k, depth + 1)]));
  if (typeof value !== 'string') return value;
  if (/^(callbackUrl|webhookUrl|url)$/i.test(key)) {
    try { const url = new URL(value); url.username = ''; url.password = ''; if (url.search) url.search = '?redacted'; url.hash = ''; return url.toString(); } catch { return '[INVALID URL]'; }
  }
  if (/^(responseBody|error|message)$/i.test(key)) {
    try { return JSON.stringify(redactAdminData(JSON.parse(value), '', depth + 1)); } catch { /* non-JSON diagnostics */ }
    return value.replace(/\bBearer\s+[^\s,"']+/gi, 'Bearer [REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|password|secret|signature)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[REDACTED]').slice(0, 20000);
  }
  return value;
}
