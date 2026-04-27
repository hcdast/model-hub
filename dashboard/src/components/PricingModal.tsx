import { useEffect, useMemo, useState } from 'react';
import { Modal, Table, InputNumber, Typography, message, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { modelApi } from '../services/api';
import {
  PricingEntry,
  getModelCategory,
  calcCost,
  calcRevenue,
  calcProfitMargin,
  hasChanges,
  formatMoney,
  formatPercent,
} from '../utils/pricing-calc';

export interface PricingModalProps {
  open: boolean;
  modelConfig: {
    _id: string;
    model_name: string;
    model_type: number;
    label: string;
    unit_price_map: Record<string, PricingEntry>;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PricingRow {
  resolution: string;
  cost_unit_price: number;
  sale_unit_price: number;
  unit_credit: number;
  original_unit_credit: number;
  unit_duration?: number;
  cost: number;
  revenue: number;
  profitMargin: number | null;
}

function buildRows(
  priceMap: Record<string, PricingEntry>,
  modelType: number,
): PricingRow[] {
  const category = getModelCategory(modelType);
  return Object.entries(priceMap).map(([resolution, entry]) => {
    const cost = calcCost(entry, category);
    const revenue = calcRevenue(entry, category);
    return {
      resolution,
      cost_unit_price: entry.cost_unit_price,
      sale_unit_price: entry.sale_unit_price,
      unit_credit: entry.unit_credit,
      original_unit_credit: entry.original_unit_credit,
      unit_duration: entry.unit_duration,
      cost,
      revenue,
      profitMargin: calcProfitMargin(cost, revenue),
    };
  });
}

export default function PricingModal({ open, modelConfig, onClose, onSaved }: PricingModalProps) {
  const [editMap, setEditMap] = useState<Record<string, PricingEntry>>({});
  const [saving, setSaving] = useState(false);

  // Reset edit state when modal opens with new model
  useEffect(() => {
    if (open && modelConfig?.unit_price_map) {
      setEditMap(JSON.parse(JSON.stringify(modelConfig.unit_price_map)));
    }
  }, [open, modelConfig]);

  const category = useMemo(
    () => (modelConfig ? getModelCategory(modelConfig.model_type) : 'image'),
    [modelConfig],
  );
  const isVideo = category === 'video';

  const rows = useMemo(() => {
    if (!modelConfig) return [];
    return buildRows(editMap, modelConfig.model_type);
  }, [editMap, modelConfig]);

  const handleFieldChange = (
    resolution: string,
    field: keyof PricingEntry,
    value: number | null,
  ) => {
    if (value === null || value < 0) return;
    setEditMap((prev) => ({
      ...prev,
      [resolution]: { ...prev[resolution], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!modelConfig) return;
    if (!hasChanges(modelConfig.unit_price_map, editMap)) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await modelApi.updatePricing(modelConfig._id, editMap);
      message.success('定价更新成功');
      onSaved();
      onClose();
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<PricingRow> = [
    { title: '分辨率', dataIndex: 'resolution', key: 'resolution', width: 100 },
    {
      title: 'cost_unit_price',
      dataIndex: 'cost_unit_price',
      key: 'cost_unit_price',
      width: 140,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          step={0.0001}
          value={r.cost_unit_price}
          onChange={(v) => handleFieldChange(r.resolution, 'cost_unit_price', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'sale_unit_price',
      dataIndex: 'sale_unit_price',
      key: 'sale_unit_price',
      width: 140,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          step={0.0001}
          value={r.sale_unit_price}
          onChange={(v) => handleFieldChange(r.resolution, 'sale_unit_price', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'unit_credit',
      dataIndex: 'unit_credit',
      key: 'unit_credit',
      width: 120,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          value={r.unit_credit}
          onChange={(v) => handleFieldChange(r.resolution, 'unit_credit', v)}
          style={{
            width: '100%',
            ...(r.unit_credit < r.original_unit_credit ? { color: '#fa8c16' } : {}),
          }}
        />
      ),
    },
    {
      title: 'original_unit_credit',
      dataIndex: 'original_unit_credit',
      key: 'original_unit_credit',
      width: 150,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          value={r.original_unit_credit}
          onChange={(v) => handleFieldChange(r.resolution, 'original_unit_credit', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    ...(isVideo
      ? [
          {
            title: 'unit_duration',
            dataIndex: 'unit_duration' as const,
            key: 'unit_duration',
            width: 120,
            render: (_: unknown, r: PricingRow) => (
              <InputNumber
                size="small"
                min={0}
                value={r.unit_duration}
                onChange={(v: number | null) =>
                  handleFieldChange(r.resolution, 'unit_duration', v)
                }
                style={{ width: '100%' }}
              />
            ),
          },
        ]
      : []),
    {
      title: isVideo ? '每秒成本' : '每张成本',
      key: 'cost',
      width: 110,
      render: (_, r) => formatMoney(r.cost),
    },
    {
      title: '收入',
      key: 'revenue',
      width: 110,
      render: (_, r) => formatMoney(r.revenue),
    },
    {
      title: '利润率',
      key: 'profitMargin',
      width: 100,
      render: (_, r) =>
        r.profitMargin === null ? (
          <Typography.Text type="secondary">N/A</Typography.Text>
        ) : (
          `${formatPercent(r.profitMargin)}%`
        ),
    },
  ];

  const formulaText = isVideo
    ? '成本 = cost_unit_price | 收入 = unit_credit × sale_unit_price ÷ unit_duration | 利润率 = (收入 - 成本) / 收入 × 100%'
    : '成本 = cost_unit_price | 收入 = unit_credit × sale_unit_price | 利润率 = (收入 - 成本) / 收入 × 100%';

  return (
    <Modal
      title={`定价表 — ${modelConfig?.label || modelConfig?.model_name || ''} (${isVideo ? '视频类' : '图片类'})`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={isVideo ? 1200 : 1080}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        message={<Typography.Text style={{ fontSize: 12 }}>{formulaText}</Typography.Text>}
        style={{ marginBottom: 12 }}
      />
      <Table<PricingRow>
        columns={columns}
        dataSource={rows}
        rowKey="resolution"
        pagination={false}
        size="small"
        scroll={{ x: isVideo ? 1150 : 1030 }}
      />
    </Modal>
  );
}
