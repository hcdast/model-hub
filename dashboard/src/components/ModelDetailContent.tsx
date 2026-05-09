import { Collapse, Descriptions, Space, Tag, Typography, theme } from 'antd';
import dayjs from 'dayjs';
import type { CSSProperties, ReactNode } from 'react';

const { Text } = Typography;

/** 展示格式：英文（中文），与后端字段名一致 */
const LABEL: Record<string, string> = {
  _id: '_id（文档 ID）',
  model_name: 'model_name（模型名称）',
  provider_model_name: 'provider_model_name（提供商模型名）',
  label: 'label（显示标签）',
  provider: 'provider（提供商）',
  service: 'service（服务标识）',
  model_type: 'model_type（模型类型）',
  group: 'group（分组）',
  description: 'description（描述）',
  tags: 'tags（标签）',
  sort: 'sort（排序）',
  disabled: 'disabled（禁用）',
  unusable: 'unusable（不可用）',
  display: 'display（展示）',
  cost_unit_price: 'cost_unit_price（成本单价 USD）',
  sale_unit_price: 'sale_unit_price（售价 USD/credit）',
  audio_extra_credit_multiplier: 'audio_extra_credit_multiplier（音频额外 credit 倍率）',
  unit_price_map: 'unit_price_map（单位价格映射）',
  unit_usd_map: 'unit_usd_map（单位 USD 映射）',
  discount: 'discount（折扣）',
  supported_unlimit_days_monthly: 'supported_unlimit_days_monthly（月付无限可用天数）',
  supported_unlimit_days_yearly: 'supported_unlimit_days_yearly（年付无限可用天数）',
  lock_duration_limit: 'lock_duration_limit（锁定时长限制）',
  params: 'params（完整参数）',
  requires_priority: 'requires_priority（优先级要求）',
  requires_priority_4_unlimit_mode: 'requires_priority_4_unlimit_mode（无限模式优先级）',
  requires_priority_4_unlimit_mode_monthly: 'requires_priority_4_unlimit_mode_monthly（月付无限模式优先级）',
  requires_priority_4_unlimit_mode_yearly: 'requires_priority_4_unlimit_mode_yearly（年付无限模式优先级）',
  supported_unlimit_mode: 'supported_unlimit_mode（支持无限模式）',
  supported_unlimit_mode_start_time: 'supported_unlimit_mode_start_time（无限模式开始时间）',
  supported_last_frame: 'supported_last_frame（支持尾帧）',
  supported_first_frame: 'supported_first_frame（支持首帧）',
  supported_extend_prompt: 'supported_extend_prompt（支持扩展提示）',
  supported_reference: 'supported_reference（支持参考）',
  supported_variation: 'supported_variation（支持变体）',
  supported_keep_original_sound: 'supported_keep_original_sound（保留原声）',
  supported_web_search: 'supported_web_search（支持联网搜索）',
  is_extend_model: 'is_extend_model（扩展模型）',
  supports_elements: 'supports_elements（支持元素）',
  supports_reference: 'supports_reference（支持参考配置）',
  supports_inline_media: 'supports_inline_media（内联媒体）',
  support_all_in_one_reference: 'support_all_in_one_reference（一体化参考）',
  max_resource_count: 'max_resource_count（最大资源数）',
  create_time: 'create_time（创建时间）',
  update_time: 'update_time（更新时间）',
};

const BASIC_KEYS = [
  '_id', 'model_name', 'provider_model_name', 'label', 'provider', 'service',
  'model_type', 'group', 'description', 'tags', 'sort', 'disabled', 'unusable', 'display',
] as const;

const BILLING_SCALAR_KEYS = [
  'cost_unit_price', 'sale_unit_price', 'audio_extra_credit_multiplier',
] as const;

const ACCESS_SCALAR_KEYS = [
  'requires_priority', 'requires_priority_4_unlimit_mode',
  'requires_priority_4_unlimit_mode_monthly', 'requires_priority_4_unlimit_mode_yearly',
  'supported_unlimit_mode', 'supported_unlimit_mode_start_time',
] as const;

const FEATURE_KEYS = [
  'supported_last_frame', 'supported_first_frame', 'supported_extend_prompt',
  'supported_reference', 'supported_variation', 'supported_keep_original_sound',
  'supported_web_search', 'is_extend_model',
  'supports_elements', 'supports_reference', 'supports_inline_media',
  'support_all_in_one_reference',
] as const;

const LIMIT_SCALAR_KEYS = ['max_resource_count'] as const;

const NESTED_PANEL_KEYS = [
  'unit_price_map',
  'unit_usd_map',
  'output_quantity_config',
  'discount',
  'supported_unlimit_days_monthly',
  'supported_unlimit_days_yearly',
  'lock_duration_limit',
  'params',
] as const;

function formatTime(ts: unknown): string {
  if (ts == null || typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

function jsonBlock(value: unknown): string {
  if (value === undefined || value === null) return '（空）';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderScalar(detail: Record<string, unknown>, key: string): ReactNode {
  const v = detail[key];
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') {
    return <Tag color={v ? 'processing' : 'default'}>{v ? '是' : '否'}</Tag>;
  }
  if (key === 'tags' && Array.isArray(v)) {
    if (v.length === 0) return '—';
    return (
      <Space size={[4, 4]} wrap>
        {v.map((t, i) => (
          <Tag key={i}>{typeof t === 'string' || typeof t === 'number' ? String(t) : JSON.stringify(t)}</Tag>
        ))}
      </Space>
    );
  }
  if (typeof v === 'object') return <Text type="secondary">（见下方 JSON）</Text>;
  return String(v);
}

type DescItemsOpts = { span?: number };

function descItems(
  detail: Record<string, unknown>,
  keys: readonly string[],
  opts?: DescItemsOpts,
) {
  return keys
    .filter((k) => k in detail)
    .map((k) => ({
      key: k,
      label: LABEL[k] || k,
      span: opts?.span,
      children: renderScalar(detail, k),
    }));
}

export default function ModelDetailContent({ detail }: { detail: Record<string, unknown> }) {
  const { token } = theme.useToken();

  const preStyle: CSSProperties = {
    margin: 0,
    padding: '12px 14px',
    background: token.colorFillAlter,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    fontSize: 13,
    lineHeight: 1.65,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
    maxHeight: 400,
    overflow: 'auto',
  };

  const collapseItems = NESTED_PANEL_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(detail, key))
    .map((key) => ({
      key,
      label: LABEL[key] || key,
      children: <pre style={preStyle}>{jsonBlock(detail[key])}</pre>,
    }));
  const metaItems = [
    { key: 'create_time', label: LABEL.create_time, children: formatTime(detail.create_time) },
    { key: 'update_time', label: LABEL.update_time, children: formatTime(detail.update_time) },
  ];

  const known = new Set<string>([
    ...BASIC_KEYS,
    ...BILLING_SCALAR_KEYS,
    ...ACCESS_SCALAR_KEYS,
    ...FEATURE_KEYS,
    ...LIMIT_SCALAR_KEYS,
    ...NESTED_PANEL_KEYS,
    'create_time',
    'update_time',
    'output_quantity_config',
  ]);

  const extraKeys = Object.keys(detail).filter(
    (k) => !known.has(k) && !k.startsWith('__'),
  );
  const extraJson = extraKeys.length
    ? <pre style={preStyle}>{jsonBlock(Object.fromEntries(extraKeys.map((k) => [k, detail[k]])))}</pre>
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Descriptions
        title="Basic（基础信息）"
        bordered
        size="small"
        column={1}
        styles={{ label: { minWidth: 280, maxWidth: 400, whiteSpace: 'normal' } }}
        items={descItems(detail, BASIC_KEYS, { span: 1 })}
      />

      <Descriptions
        title="Billing scalar（计费标量）"
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        styles={{ label: { minWidth: 200, whiteSpace: 'normal' } }}
        items={descItems(detail, BILLING_SCALAR_KEYS)}
      />

      {collapseItems.length > 0 && (
        <Collapse
          bordered={false}
          style={{ background: token.colorBgContainer }}
          items={collapseItems.map((it) => ({
            key: it.key,
            label: it.label,
            children: it.children,
          }))}
          defaultActiveKey={collapseItems.some((c) => c.key === 'params') ? ['params'] : [collapseItems[0].key]}
        />
      )}

      <Descriptions
        title="Access & unlimit（访问与无限模式）"
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        styles={{ label: { minWidth: 200, whiteSpace: 'normal' } }}
        items={descItems(detail, ACCESS_SCALAR_KEYS)}
      />

      <Descriptions
        title="Features（功能开关）"
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        styles={{ label: { minWidth: 200, whiteSpace: 'normal' } }}
        items={descItems(detail, FEATURE_KEYS)}
      />

      <Descriptions
        title="Limits（数量与限制）"
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        styles={{ label: { minWidth: 200, whiteSpace: 'normal' } }}
        items={[
          ...descItems(detail, LIMIT_SCALAR_KEYS),
          ...metaItems,
        ]}
      />

      {extraJson && (
        <Collapse
          bordered={false}
          style={{ background: token.colorBgContainer }}
          items={[{
            key: 'extra',
            label: 'other_fields（其他 / 未分类字段）',
            children: extraJson,
          }]}
        />
      )}
    </div>
  );
}
