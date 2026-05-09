export type ModelCategory = 'image' | 'video';

export interface PricingEntry {
  cost_unit_price: number;
  sale_unit_price: number;
  unit_credit: number;
  original_unit_credit: number;
  unit_duration?: number;
}

export function getModelCategory(modelType: number): ModelCategory {
  // 与后端 PricingService.inferUsageType 对齐：1500~1599 为视频生成/编辑（按时长计费）
  if (modelType >= 1500 && modelType <= 1599) return 'video';
  // 兼容历史 model_type 分段（如 42xxx 曾用于视频类）
  if (Math.floor(modelType / 1000) === 42) return 'video';
  return 'image';
}

export function calcCost(entry: PricingEntry, _category: ModelCategory): number {
  return entry.cost_unit_price;
}

export function calcRevenue(entry: PricingEntry, category: ModelCategory): number {
  if (category === 'video') {
    const duration = entry.unit_duration && entry.unit_duration > 0 ? entry.unit_duration : 5;
    return (entry.unit_credit * entry.sale_unit_price) / duration;
  }
  return entry.unit_credit * entry.sale_unit_price;
}

export function calcProfitMargin(cost: number, revenue: number): number | null {
  if (revenue <= 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

export function isValidPricingInput(value: string): boolean {
  if (value.trim() === '') return false;
  const num = Number(value);
  return !isNaN(num) && num >= 0;
}

export function hasChanges(
  original: Record<string, PricingEntry>,
  current: Record<string, PricingEntry>,
): boolean {
  const origKeys = Object.keys(original);
  const currKeys = Object.keys(current);
  if (origKeys.length !== currKeys.length) return true;
  for (const key of origKeys) {
    if (!(key in current)) return true;
    const o = original[key];
    const c = current[key];
    if (
      o.cost_unit_price !== c.cost_unit_price ||
      o.sale_unit_price !== c.sale_unit_price ||
      o.unit_credit !== c.unit_credit ||
      o.original_unit_credit !== c.original_unit_credit ||
      o.unit_duration !== c.unit_duration
    ) {
      return true;
    }
  }
  return false;
}

export function formatMoney(n: number): string {
  return n.toFixed(4);
}

export function formatPercent(n: number): string {
  return n.toFixed(2);
}
