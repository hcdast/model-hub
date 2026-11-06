export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin && !/^\/login(?:\/|$)/.test(parsed.pathname)
      ? parsed.pathname + parsed.search + parsed.hash : '/';
  } catch { return '/'; }
}
