import { Collapse, Descriptions, Space, Tag, Typography, theme } from 'antd';
import dayjs from 'dayjs';
import type { CSSProperties, ReactNode } from 'react';

const { Text } = Typography;

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
  unit_price_map: 'unit_price_map（单位价格映射，须含 default 档）',
  params: 'params（完整参数）',
  create_time: 'create_time（创建时间）',
  update_time: 'update_time（更新时间）',
};

const BASIC_KEYS = [
  '_id',
  'model_name',
  'provider_model_name',
  'label',
  'provider',
  'service',
  'model_type',
  'group',
  'description',
  'tags',
  'sort',
  'disabled',
] as const;

const NESTED_PANEL_KEYS = ['unit_price_map', 'params'] as const;

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

  const collapseItems = NESTED_PANEL_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(detail, key),
  ).map((key) => ({
    key,
    label: LABEL[key] || key,
    children: <pre style={preStyle}>{jsonBlock(detail[key])}</pre>,
  }));

  const metaItems = [
    { key: 'create_time', label: LABEL.create_time, children: formatTime(detail.create_time) },
    { key: 'update_time', label: LABEL.update_time, children: formatTime(detail.update_time) },
  ];

  const known = new Set<string>([...BASIC_KEYS, ...NESTED_PANEL_KEYS, 'create_time', 'update_time']);

  const extraKeys = Object.keys(detail).filter((k) => !known.has(k) && !k.startsWith('__'));
  const extraJson = extraKeys.length ? (
    <pre style={preStyle}>{jsonBlock(Object.fromEntries(extraKeys.map((k) => [k, detail[k]])))}</pre>
  ) : null;

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
        title="Meta（时间）"
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        styles={{ label: { minWidth: 200, whiteSpace: 'normal' } }}
        items={metaItems}
      />

      {extraJson && (
        <Collapse
          bordered={false}
          style={{ background: token.colorBgContainer }}
          items={[
            {
              key: 'extra',
              label: 'other_fields（其他 / 未分类字段）',
              children: extraJson,
            },
          ]}
        />
      )}
    </div>
  );
}
