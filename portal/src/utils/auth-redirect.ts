/** Only return to a local portal page after authentication. */
export function getAuthReturnPath(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/';
  const from = state.from;
  const path = typeof from === 'string' ? from :
    from && typeof from === 'object' && 'pathname' in from && typeof from.pathname === 'string'
      ? `${from.pathname}${'search' in from && typeof from.search === 'string' ? from.search : ''}${'hash' in from && typeof from.hash === 'string' ? from.hash : ''}`
      : '/';
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\s\u0000-\u001f]/.test(path) || /^\/(login|register|auth|forgot-password)([/?#]|$)/i.test(path)) return '/';
  return path;
}
