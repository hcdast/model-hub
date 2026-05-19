const BARE_HTTP_URL_RE = /^https?:\/\//;

/** 整段为 http(s) URL 的字符串（非嵌套在对象中的字段值） */
export function isBareHttpUrlString(value: unknown): value is string {
  return typeof value === 'string' && BARE_HTTP_URL_RE.test(value);
}

/**
 * 统一任务 result 形态：顶层裸 URL 字符串规范为 string[]。
 * 对象结构（如 { output: [...] }）、非 URL 标量保持不变。
 */
export function normalizeTaskResultPayload(payload: unknown): unknown {
  if (payload == null) return payload;
  if (isBareHttpUrlString(payload)) return [payload];
  if (Array.isArray(payload)) {
    return payload.map((item) =>
      isBareHttpUrlString(item) ? item : normalizeTaskResultPayload(item),
    );
  }
  return payload;
}
