import { createHash } from 'crypto';

/** 递归收集 payload 中的 http(s) URL（去重后排序，用于指纹） */
export function collectHttpUrlsFromPayload(obj: unknown): string[] {
  const found: string[] = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const v of Object.values(o as Record<string, unknown>)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) {
        found.push(v);
      } else if (typeof v === 'object' && v !== null) {
        walk(v);
      }
    }
  };
  walk(obj);
  return [...new Set(found)].sort();
}

/** 输入/输出 URL 集合变化时指纹变化，用于判断缓存是否仍有效 */
export function fingerprintTaskResourceUrls(
  requestPayload: unknown,
  resultPayload: unknown,
): string {
  const input = collectHttpUrlsFromPayload(requestPayload);
  const output = collectHttpUrlsFromPayload(resultPayload);
  return createHash('sha256')
    .update(JSON.stringify({ input, output }))
    .digest('hex');
}
