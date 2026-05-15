/** 结构化编辑中的「基础信息」字段（不含 params / unit_price_map） */
export const BASIC_FIELD_NAMES = [
  'model_id',
  'model_type',
  'provider',
  'provider_model_name',
  'model_name',
  'description',
  'tags',
  'sort',
  'disabled',
] as const;

export type BasicFieldName = (typeof BASIC_FIELD_NAMES)[number];

export const DEFAULT_TIER_PRICE_KEYS = [
  'sale_unit_price',
  'cost_unit_price',
  'unit_credit',
  'original_unit_credit',
] as const;
