/**
 * unit_price_map 档位解析与厂商参考 credit（unit_credit）提取。
 * 旧版 unit_credit_map 已废弃，逻辑统一到此映射。
 */

export function resolveUnitPriceMapTier(
  unitPriceMap: Record<string, unknown> | undefined,
  tierKey?: string,
): { entry?: Record<string, unknown>; usedKey?: string } {
  if (!unitPriceMap || typeof unitPriceMap !== 'object') return {};

  const asTier = (v: unknown): Record<string, unknown> | undefined =>
    v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

  if (tierKey && tierKey.trim()) {
    const k = tierKey.trim();
    let hit = asTier(unitPriceMap[k]);
    if (hit) return { entry: hit, usedKey: k };
    const kl = k.toLowerCase();
    for (const key of Object.keys(unitPriceMap)) {
      if (key === 'default') continue;
      if (key.toLowerCase() === kl) {
        hit = asTier(unitPriceMap[key]);
        if (hit) return { entry: hit, usedKey: key };
      }
    }
  }

  const def = asTier(unitPriceMap.default);
  if (def) return { entry: def, usedKey: 'default' };
  return {};
}

/** 扁平档位：default 或任意值为正数时视为 credit 单价（兼容旧扁平 map） */
export function extractFallbackNumericCredit(unitPriceMap?: Record<string, unknown>): number {
  if (!unitPriceMap || typeof unitPriceMap !== 'object') return 0;
  const def = unitPriceMap.default;
  if (typeof def === 'number' && def > 0 && Number.isFinite(def)) return def;
  for (const v of Object.values(unitPriceMap)) {
    if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * 厂商参考 credit：优先命中档位的 unit_credit，其次 default 档位，最后扁平数值兜底。
 */
export function pickCreditReferenceUnitFromPriceMap(
  unitPriceMap: Record<string, unknown> | undefined,
  tierKey?: string,
): number {
  const { entry, usedKey } = resolveUnitPriceMapTier(unitPriceMap, tierKey);
  if (entry && typeof entry.unit_credit === 'number' && entry.unit_credit > 0) {
    return entry.unit_credit;
  }
  if (usedKey && usedKey !== 'default') {
    const defEntry = resolveUnitPriceMapTier(unitPriceMap, undefined).entry;
    if (defEntry && typeof defEntry.unit_credit === 'number' && defEntry.unit_credit > 0) {
      return defEntry.unit_credit;
    }
  }
  return extractFallbackNumericCredit(unitPriceMap);
}
