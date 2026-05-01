import { useEffect, useState } from 'react';
import { Modal, Radio, Button, Space, Typography, Descriptions, message, Alert } from 'antd';
import { ExclamationCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { providerHealthApi } from '../services/provider-health';

export interface ManualOverrideInfo {
  /** 覆盖的目标状态 */
  state: 'CLOSED' | 'OPEN';
  /** 操作人 */
  operator: string;
  /** 操作时间戳（ISO 8601） */
  timestamp: string;
}

export interface CircuitBreakerOverrideModalProps {
  /** 弹窗是否可见 */
  open: boolean;
  /** Provider 名称 */
  provider: string;
  /** 当前手动覆盖信息（null 表示无覆盖） */
  manualOverride: ManualOverrideInfo | null;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 操作成功后回调（用于刷新数据） */
  onSuccess: () => void;
}

/**
 * 手动熔断覆盖确认弹窗
 * - 支持强制设为 OPEN 或 CLOSED
 * - 覆盖后显示操作人和时间戳
 * - 支持清除覆盖恢复自动熔断
 */
export default function CircuitBreakerOverrideModal({
  open,
  provider,
  manualOverride,
  onClose,
  onSuccess,
}: CircuitBreakerOverrideModalProps) {
  // 目标状态选择
  const [targetState, setTargetState] = useState<'OPEN' | 'CLOSED'>('OPEN');
  // 提交中状态
  const [submitting, setSubmitting] = useState(false);
  // 清除覆盖中状态
  const [clearing, setClearing] = useState(false);

  // 弹窗打开时重置状态
  useEffect(() => {
    if (open) {
      setTargetState('OPEN');
      setSubmitting(false);
      setClearing(false);
    }
  }, [open]);

  /** 执行手动覆盖 */
  const handleOverride = async () => {
    setSubmitting(true);
    try {
      await providerHealthApi.overrideCircuitBreaker(provider, targetState);
      message.success(`已将 ${provider} 熔断状态强制设为 ${targetState}`);
      onSuccess();
      onClose();
    } catch {
      message.error('覆盖操作失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  /** 清除手动覆盖，恢复自动熔断 */
  const handleClearOverride = async () => {
    setClearing(true);
    try {
      await providerHealthApi.clearOverride(provider);
      message.success(`已清除 ${provider} 的手动覆盖，恢复自动熔断`);
      onSuccess();
      onClose();
    } catch {
      message.error('清除覆盖失败，请重试');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          <span>手动覆盖熔断状态 — {provider}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={520}
    >
      {/* 当前覆盖信息展示 */}
      {manualOverride && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前存在手动覆盖"
          description={
            <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
              <Descriptions.Item label="覆盖状态">
                <Typography.Text strong>
                  {manualOverride.state}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="操作人">
                {manualOverride.operator}
              </Descriptions.Item>
              <Descriptions.Item label="操作时间">
                {new Date(manualOverride.timestamp).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>
          }
          action={
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={clearing}
              onClick={handleClearOverride}
            >
              清除覆盖
            </Button>
          }
        />
      )}

      {/* 目标状态选择 */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
          选择目标状态：
        </Typography.Text>
        <Radio.Group
          value={targetState}
          onChange={(e) => setTargetState(e.target.value)}
        >
          <Radio.Button value="OPEN">
            OPEN（强制熔断）
          </Radio.Button>
          <Radio.Button value="CLOSED">
            CLOSED（强制恢复）
          </Radio.Button>
        </Radio.Group>
      </div>

      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        手动覆盖后，自动熔断逻辑将被暂停，直到清除覆盖为止。
      </Typography.Text>

      {/* 操作按钮 */}
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={handleOverride}
          >
            确认覆盖
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
