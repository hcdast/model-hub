import Table from './AdminTable';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, InputNumber, Typography, message, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { modelApi } from '../services/api';
import { modelUsageType } from '@model-hub/common/utils/model-pricing';
import { billingUsageSuffix } from '../utils/billing-units';
import { useUnsavedClose } from '../hooks/useUnsavedClose';
import {
  PricingEntry,
  getModelCategory,
  calcCost,
  calcProfitMargin,
  hasChanges,
  formatPercent,
} from '../utils/pricing-calc';

export interface PricingModalProps {
  open: boolean;
  modelConfig: {
    _id: string;
    revision?: number;
    model_id: string;
    model_type: string;
    model_name: string;
    pricing?: { usage_type?: string; usage_measure?: string };
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
  modelType: string | number,
): PricingRow[] {
  const category = getModelCategory(modelType);
  return Object.entries(priceMap).map(([resolution, entry]) => {
    const cost = calcCost(entry, category);
    // The runtime charges unit_credit for every measured unit, including seconds.
    const revenue = entry.unit_credit * entry.sale_unit_price;
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
  const saveLock = useRef(false);
  const closeEditor = useUnsavedClose(!!modelConfig && hasChanges(modelConfig.unit_price_map || {}, editMap), saving, onClose);
  const usageType = modelConfig?.pricing?.usage_type || modelUsageType(modelConfig?.model_type || '');
  const unit = billingUsageSuffix({ usageType, usageMeasure: modelConfig?.pricing?.usage_measure }, modelConfig?.model_type) || '单位';
  const money = (value: number) => !Number.isFinite(value) ? '—' : value !== 0 && Math.abs(value) < 1e-10 ? value.toExponential(4) : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 });

  // Reset edit state when modal opens with new model
  useEffect(() => {
    if (open && modelConfig) {
      const priceMap = JSON.parse(JSON.stringify(modelConfig.unit_price_map || {}));
      if (!priceMap.default) {
        priceMap.default = { cost_unit_price: 0, sale_unit_price: 0, unit_credit: 0, original_unit_credit: 0 };
      }
      setEditMap(priceMap);
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
    if (!modelConfig || saveLock.current) return;
    if (!hasChanges(modelConfig.unit_price_map || {}, editMap)) {
      onClose();
      return;
    }
    saveLock.current = true;
    setSaving(true);
    try {
      await modelApi.updatePricing(modelConfig._id, editMap, modelConfig.revision || 0);
      message.success('定价更新成功');
      onSaved();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || '保存失败');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const columns: ColumnsType<PricingRow> = [
    { title: '价格档位', dataIndex: 'resolution', key: 'resolution', width: 100 },
    {
      title: `参考成本（USD/${unit}）`,
      dataIndex: 'cost_unit_price',
      key: 'cost_unit_price',
      width: 140,
      render: (_, r) => (
        <InputNumber
          disabled={saving}
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
      title: '美元参考换算（USD/credit）',
      dataIndex: 'sale_unit_price',
      key: 'sale_unit_price',
      width: 140,
      render: (_, r) => (
        <InputNumber
          disabled={saving}
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
      title: `计费单价（credits/${unit}）`,
      dataIndex: 'unit_credit',
      key: 'unit_credit',
      width: 120,
      render: (_, r) => (
        <InputNumber
          disabled={saving}
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
      title: `原价（credits/${unit}）`,
      dataIndex: 'original_unit_credit',
      key: 'original_unit_credit',
      width: 150,
      render: (_, r) => (
        <InputNumber
          disabled={saving}
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
            title: '参考时长（秒）',
            dataIndex: 'unit_duration' as const,
            key: 'unit_duration',
            width: 120,
            render: (_: unknown, r: PricingRow) => (
              <InputNumber
                disabled={saving}
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
      title: `参考收入（USD/${unit}）`,
      key: 'revenue',
      width: 110,
      render: (_, r) => money(r.revenue),
    },
    {
      title: '参考利润率',
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

  const formulaText = `按${unit}计费：费用 = 用量 × 计费单价（credits/${unit}）。美元参考收入 = 计费单价 × 美元参考换算；参考利润率 =（参考收入 − 参考成本）÷ 参考收入。参考值不代表已结算收益。`;

  return (
    <Modal
      title={`定价表 — ${modelConfig?.model_name || modelConfig?.model_id || ''}（按${unit}）`}
      open={open}
      onCancel={closeEditor}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      cancelButtonProps={{ disabled: saving }}
      width={isVideo ? 1200 : 1080}
      destroyOnClose
    >
      {!modelConfig?.unit_price_map?.default && <Alert
        type="warning"
        showIcon
        message="该模型尚未完成定价。请填写 default 档位：sale_unit_price、unit_credit 必须大于 0，cost_unit_price 必须大于或等于 0；保存后再启用模型。"
        style={{ marginBottom: 12 }}
      />}
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
      />
    </Modal>
  );
}
