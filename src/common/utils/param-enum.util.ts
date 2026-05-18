/**
 * 将 params.enum 规范为标量数组（兼容 AGI 的 { value, label, description } 形态）。
 */
export function normalizeEnumItem(item: unknown): unknown | undefined {
  if (item === null || item === undefined) return undefined;
  if (typeof item === 'object' && !Array.isArray(item) && 'value' in (item as object)) {
    return (item as { value: unknown }).value;
  }
  return item;
}

export function normalizeEnumArray(enumRaw: unknown): unknown[] {
  if (!Array.isArray(enumRaw) || enumRaw.length === 0) {
    return Array.isArray(enumRaw) ? enumRaw : [];
  }
  const normalized = enumRaw
    .map(normalizeEnumItem)
    .filter((v) => v !== undefined && v !== null);
  if (normalized.length === 0) return enumRaw;
  const hasNestedObject = normalized.some(
    (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  );
  if (hasNestedObject) return enumRaw;
  return normalized;
}

/** 校验/展示用：将 enum 转为标量列表 */
export function resolveEnumValues(enumRaw: unknown[] | undefined): unknown[] {
  if (!enumRaw || !Array.isArray(enumRaw)) return [];
  const normalized = normalizeEnumArray(enumRaw);
  return Array.isArray(normalized) ? normalized : [];
}
