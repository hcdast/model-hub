import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Space,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { DEFAULT_TIER_PRICE_KEYS } from './constants';

export interface UnitPriceMapSectionProps {
  unitPriceMap: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}

function readTier(
  unitPriceMap: Record<string, any>,
  key: string,
): Record<string, number | undefined> {
  const t = unitPriceMap?.[key];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
  const o: Record<string, number | undefined> = {};
  for (const k of DEFAULT_TIER_PRICE_KEYS) {
    const v = (t as Record<string, unknown>)[k];
    o[k] = typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
  return o;
}

export function UnitPriceMapSection({
  unitPriceMap,
  onChange,
}: UnitPriceMapSectionProps) {
  const defaultTier = useMemo(
    () => readTier(unitPriceMap, 'default'),
    [unitPriceMap],
  );

  const extraTierNames = useMemo(() => {
    return Object.keys(unitPriceMap || {}).filter((k) => k !== 'default');
  }, [unitPriceMap]);

  const [addOpen, setAddOpen] = useState(false);
  const [newTierKey, setNewTierKey] = useState('');

  const patchDefault = (patch: Record<string, number | undefined | null>) => {
    const cur =
      unitPriceMap?.default && typeof unitPriceMap.default === 'object'
        ? { ...unitPriceMap.default }
        : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete (cur as any)[k];
      else (cur as any)[k] = v;
    }
    onChange({ ...unitPriceMap, default: cur });
  };

  const patchTier = (
    tierKey: string,
    patch: Record<string, number | undefined | null>,
  ) => {
    const cur =
      unitPriceMap?.[tierKey] && typeof unitPriceMap[tierKey] === 'object'
        ? { ...unitPriceMap[tierKey] }
        : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete (cur as any)[k];
      else (cur as any)[k] = v;
    }
    onChange({ ...unitPriceMap, [tierKey]: cur });
  };

  const addTier = () => {
    const k = newTierKey.trim();
    if (!k || k === 'default') {
      Modal.warning({ title: '档位键无效', content: '不能与 default 重复且不能为空。' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(unitPriceMap, k)) {
      Modal.warning({ title: '档位已存在' });
      return;
    }
    onChange({
      ...unitPriceMap,
      [k]: {
        sale_unit_price: 0.01,
        cost_unit_price: 0,
        unit_credit: 1,
        original_unit_credit: 1,
      },
    });
    setNewTierKey('');
    setAddOpen(false);
  };

  const removeTier = (tierKey: string) => {
    const next = { ...unitPriceMap };
    delete next[tierKey];
    onChange(next);
  };

  const renderTierFields = (tierKey: string, tier: Record<string, number | undefined>) => (
    <Space wrap size="large" key={tierKey}>
      <span>
        <Typography.Text type="secondary">sale_unit_price</Typography.Text>
        <InputNumber
          style={{ width: 140, marginLeft: 8 }}
          min={0}
          step={0.01}
          value={tier.sale_unit_price}
          onChange={(v) =>
            tierKey === 'default'
              ? patchDefault({ sale_unit_price: v ?? undefined })
              : patchTier(tierKey, { sale_unit_price: v ?? undefined })
          }
        />
      </span>
      <span>
        <Typography.Text type="secondary">cost_unit_price</Typography.Text>
        <InputNumber
          style={{ width: 140, marginLeft: 8 }}
          min={0}
          step={0.01}
          value={tier.cost_unit_price}
          onChange={(v) =>
            tierKey === 'default'
              ? patchDefault({ cost_unit_price: v ?? undefined })
              : patchTier(tierKey, { cost_unit_price: v ?? undefined })
          }
        />
      </span>
      <span>
        <Typography.Text type="secondary">unit_credit</Typography.Text>
        <InputNumber
          style={{ width: 120, marginLeft: 8 }}
          min={0}
          step={1}
          value={tier.unit_credit}
          onChange={(v) =>
            tierKey === 'default'
              ? patchDefault({ unit_credit: v ?? undefined })
              : patchTier(tierKey, { unit_credit: v ?? undefined })
          }
        />
      </span>
      <span>
        <Typography.Text type="secondary">original_unit_credit</Typography.Text>
        <InputNumber
          style={{ width: 120, marginLeft: 8 }}
          min={0}
          step={1}
          value={tier.original_unit_credit}
          onChange={(v) =>
            tierKey === 'default'
              ? patchDefault({ original_unit_credit: v ?? undefined })
              : patchTier(tierKey, { original_unit_credit: v ?? undefined })
          }
        />
      </span>
    </Space>
  );

  return (
    <Card size="small" title="价格信息（unit_price_map）">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        必须包含 default 档位，且 default 内需有 sale_unit_price（&gt;0）、cost_unit_price（≥0）、unit_credit（&gt;0）。
      </Typography.Paragraph>

      <Typography.Title level={5}>default 档位</Typography.Title>
      <div style={{ marginBottom: 16 }}>{renderTierFields('default', defaultTier)}</div>

      <Space style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          其它档位
        </Typography.Title>
        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加档位
        </Button>
      </Space>

      {extraTierNames.length === 0 ? (
        <Typography.Text type="secondary">暂无额外档位</Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {extraTierNames.map((name) => (
            <Card key={name} size="small" type="inner" title={name}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {renderTierFields(name, readTier(unitPriceMap, name))}
                <Button
                  danger
                  type="link"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeTier(name)}
                >
                  删除该档位
                </Button>
              </Space>
            </Card>
          ))}
        </Space>
      )}

      <Modal
        title="新档位键名"
        open={addOpen}
        onOk={addTier}
        onCancel={() => setAddOpen(false)}
        destroyOnClose
      >
        <Input
          value={newTierKey}
          onChange={(e) => setNewTierKey(e.target.value)}
          placeholder="例如 hd、4k"
        />
      </Modal>
    </Card>
  );
}
