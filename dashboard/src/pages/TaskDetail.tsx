import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Steps, Button, Space, Typography, Spin, message, Tag, Divider, Popconfirm, Row, Col, Tooltip, Image, Modal } from 'antd';
import {
  ArrowLeftOutlined, RedoOutlined, StopOutlined, DollarOutlined, PictureOutlined,
  VideoCameraOutlined, AudioOutlined, LinkOutlined, DownloadOutlined, InfoCircleOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import StatusTag from '../components/StatusTag';
import { taskApi, modelApi } from '../services/api';
import { priorityToLabel, formatDateTime } from '../utils/format-helpers';
import { usePermission } from '../hooks/usePermission';

/** 计费状态中文映射 */
const BILLING_STATUS_MAP: Record<string, { label: string; color: string }> = {
  estimated: { label: '已预估', color: 'blue' },
  pre_deducted: { label: '已预扣', color: 'orange' },
  settled: { label: '已结算', color: 'green' },
  refunded: { label: '已退款', color: 'default' },
  failed: { label: '扣费失败', color: 'red' },
};

/** 计费策略中文映射 */
const BILLING_POLICY_MAP: Record<string, { label: string; color: string }> = {
  internal: { label: '内部计费', color: 'blue' },
  external: { label: '外部记录', color: 'green' },
  exempt: { label: '免计费', color: 'default' },
};

/** 用量类型中文映射 */
const USAGE_TYPE_MAP: Record<string, string> = {
  token: 'Token',
  count: '按次',
  duration: '按时长',
};

/** 时间线事件中文 */
const TIMELINE_EVENT_LABELS: Record<string, string> = {
  TASK_CREATED: '任务已创建',
  TASK_ENQUEUED: '任务已入队',
  TASK_DEQUEUED: '任务已出队',
  PROVIDER_SUBMIT_START: '提交厂商（开始）',
  PROVIDER_SUBMIT_OK: '提交厂商成功',
  PROVIDER_SUBMIT_FAIL: '提交厂商失败',
  POLL_START: '轮询查询（开始）',
  POLL_RESULT: '轮询结果',
  PROVIDER_COMPLETED: '厂商处理完成',
  PROVIDER_FAILED: '厂商处理失败',
  TASK_SUCCESS: '任务成功',
  TASK_FAILED: '任务失败',
  TASK_TIMEOUT: '任务超时',
  TASK_CANCELLED: '任务已取消',
  CALLBACK_SEND: '回调已发送',
  CALLBACK_OK: '回调成功',
  CALLBACK_FAIL: '回调失败',
  CALLBACK_DEAD_LETTER: '回调进入死信',
  ROUTE_RESOLVED: '路由已解析',
  RETRY_ENQUEUED: '重试已入队',
  PRIORITY_CHANGED: '优先级已变更',
};

/** 时间线 detail 字段中文 */
const TIMELINE_DETAIL_KEY_LABELS: Record<string, string> = {
  pollCount: '轮询次数',
  elapsedMs: '耗时 (ms)',
  providerStatus: '厂商状态',
  progress: '进度',
  totalE2eMs: '端到端耗时 (ms)',
  errorCode: '错误码',
  queueName: '队列',
  jobId: 'Job ID',
  provider: '厂商',
  reason: '原因',
  attempt: '尝试次数',
  httpStatus: 'HTTP 状态',
  latencyMs: '延迟 (ms)',
};

function formatTimelineDetailValue(v: unknown): ReactNode {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (Array.isArray(v)) {
    return (
      <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
        {v.slice(0, 20).map((item, i) => (
          <li key={i}>{formatTimelineDetailValue(item)}</li>
        ))}
        {v.length > 20 ? <li>…共 {v.length} 项</li> : null}
      </ul>
    );
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return <Typography.Text type="secondary">（空）</Typography.Text>;
    return (
      <div style={{ marginTop: 4 }}>
        {keys.map((k) => (
          <div key={k} style={{ marginBottom: 2 }}>
            <Typography.Text type="secondary" style={{ marginRight: 6 }}>
              {TIMELINE_DETAIL_KEY_LABELS[k] || k}:
            </Typography.Text>
            {formatTimelineDetailValue(o[k])}
          </div>
        ))}
      </div>
    );
  }
  return String(v);
}

/** 与 billing.usageType 对齐的用量单位后缀（视频按时长→秒，图像按次→张） */
function billingUsageSuffix(usageType?: string): string {
  if (usageType === 'duration') return '秒';
  if (usageType === 'count') return '张';
  if (usageType === 'token') return 'Token';
  return '';
}

function formatBillingUsageValue(value: unknown, usageType?: string): string {
  if (value === undefined || value === null) return '—';
  const suf = billingUsageSuffix(usageType);
  return suf ? `${value} ${suf}` : String(value);
}

function formatUsd(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

/** 与后端 TERMINAL_STATUSES 一致：仅终态任务支持异步重拉资源元数据 */
const TASK_TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED']);

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canMutateTask = hasPermission('task:update');
  const canReadModel = hasPermission('model:read');
  const [task, setTask] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [timing, setTiming] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelDetailLoading, setModelDetailLoading] = useState(false);
  const [modelDetail, setModelDetail] = useState<any>(null);

  const openModelModal = async () => {
    if (!task?.model || !canReadModel) return;
    setModelModalOpen(true);
    setModelDetailLoading(true);
    setModelDetail(null);
    try {
      const res: any = await modelApi.getDetail(encodeURIComponent(task.model));
      setModelDetail(res.data ?? null);
    } catch {
      message.error('加载模型信息失败');
    } finally {
      setModelDetailLoading(false);
    }
  };

  const reloadTaskData = useCallback(
    async (opts: { mode: 'initial' | 'manual' | 'silent'; refreshResourceMetadata?: boolean }) => {
      if (!taskId) return;
      const { mode, refreshResourceMetadata } = opts;
      if (mode === 'initial') setLoading(true);
      if (mode === 'manual') setRefreshing(true);
      try {
        const params = refreshResourceMetadata ? { refreshResourceMetadata: '1' } : undefined;
        const [t, tl, tm]: any[] = await Promise.all([
          taskApi.get(taskId, params),
          taskApi.getTimeline(taskId),
          taskApi.getTiming(taskId),
        ]);
        setTask(t.data);
        setTimeline(tl.data?.timeline || []);
        setTiming(tm.data?.timing);
        if (mode === 'manual') {
          message.success(
            refreshResourceMetadata
              ? '已刷新；资源元数据正在后台更新，请稍后再次刷新页面查看'
              : '已刷新',
          );
        }
      } catch {
        if (mode === 'manual') message.error('刷新失败');
      } finally {
        if (mode === 'initial') setLoading(false);
        if (mode === 'manual') setRefreshing(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    if (!taskId) return;
    void reloadTaskData({ mode: 'initial' });
  }, [taskId, reloadTaskData]);

  const handleReplay = async () => {
    try {
      await taskApi.replayCallback(taskId!);
      message.success('回调重放已入队');
    } catch { message.error('操作失败'); }
  };

  const handleCancel = async () => {
    try {
      await taskApi.cancel(taskId!);
      message.success('任务已取消');
      await reloadTaskData({ mode: 'silent' });
    } catch { message.error('取消失败'); }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;
  if (!task) return <Typography.Text>任务不存在</Typography.Text>;

  const formatMs = (ms?: number) => ms != null ? `${ms.toLocaleString()} ms` : '-';
  const formatFileSize = (bytes?: number) => {
    if (bytes == null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /** 从对象中递归提取所有 URL */
  const extractUrls = (obj: any, prefix = ''): { key: string; url: string }[] => {
    if (!obj || typeof obj !== 'object') return [];
    const urls: { key: string; url: string }[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        urls.push({ key: fullKey, url: value });
      } else if (typeof value === 'object' && value !== null) {
        urls.push(...extractUrls(value, fullKey));
      }
    }
    return urls;
  };

  /** 根据 URL 判断资源类型 */
  const getResourceType = (url: string): 'image' | 'video' | 'audio' | 'other' => {
    const lowerUrl = url.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)(\?|$)/.test(lowerUrl)) return 'image';
    if (/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)(\?|$)/.test(lowerUrl)) return 'video';
    if (/\.(mp3|wav|ogg|aac|flac|m4a|wma)(\?|$)/.test(lowerUrl)) return 'audio';
    return 'other';
  };

  const RESOURCE_TYPE_ICON: Record<string, React.ReactNode> = {
    image: <PictureOutlined />,
    video: <VideoCameraOutlined />,
    audio: <AudioOutlined />,
  };

  /** 格式化时长 (HH:MM:SS) */
  const formatDuration = (seconds?: number) => {
    if (seconds == null) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /** 渲染资源预览 */
  const renderResourcePreview = (url: string, resourceType: string) => {
    if (resourceType === 'image') {
      return (
        <Image
          src={url}
          alt="Resource Preview"
          style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }}
          fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMIAAADDCAYAAADQvc6UAAABRWlDQ1BJQ0MgUHJvZmlsZQAAKJFjYGASSSwoyGFhYGDIzSspCnJ3UoiIjFJgf8LAwSDCIMogwMCcmFxc4BgQ4ANUwgCjUcG3awyMIPqyLsis7PPOq3QdDFcvjV3jOD1boQVTPQrgSkktTgbSf4A4LbmgqISBgTEFyFYuLykAsTuAbJEioKOA7DkgdjqEvQHEToKwj4DVhAQ5A9k3gGyB5IxEoBmML4BsnSQk8XQkNtReEOBxcfXxUQg1Mjc0dyHgXNJBSWpFCYh2zi+oLMpMzyhRcASGVIMDCAlxmbzmCIHFEBEFMAoKDSAYN0fERHRUYAIYnMZAoYPk0E7PABNk/A7A/gzALYFhcKWDQMHB0ycA05AYJ8YGgAE9dg3HBwSAxIQ0hDP0F0Q4JN6OIgyXoIR4khKSgAO58OjkBKhhAAAAAElFTkSuQmCC"
        />
      );
    }
    if (resourceType === 'video') {
      return (
        <video
          src={url}
          controls
          style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }}
        />
      );
    }
    if (resourceType === 'audio') {
      return (
        <audio src={url} controls style={{ width: '100%' }} />
      );
    }
    return null;
  };

  /** 渲染元数据信息 */
  const renderMetadata = (url: string, resourceType: string) => {
    const metadata = task.resourceMetadata?.output?.[url] || task.resourceMetadata?.input?.[url];
    if (!metadata) return null;

    return (
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 12 }}>
        <Space wrap size={[16, 4]}>
          {metadata.fileSize != null && metadata.fileSize > 0 && (
            <span>大小: {formatFileSize(metadata.fileSize)}</span>
          )}
          {metadata.format && (
            <span>格式: {metadata.format}</span>
          )}
          {/* 图片元数据 */}
          {resourceType === 'image' && metadata.dimensions && (
            <>
              <span>尺寸: {metadata.dimensions.width}×{metadata.dimensions.height}</span>
              {metadata.aspectRatio && <span>比例: {metadata.aspectRatio}</span>}
            </>
          )}
          {/* 视频/音频元数据 */}
          {(resourceType === 'video' || resourceType === 'audio') && metadata.duration != null && (
            <span>时长: {formatDuration(metadata.duration)}</span>
          )}
          {resourceType === 'video' && metadata.resolution && (
            <span>分辨率: {metadata.resolution.width}×{metadata.resolution.height}</span>
          )}
          {resourceType === 'video' && metadata.codec && (
            <span>视频编码: {metadata.codec}</span>
          )}
          {resourceType === 'video' && metadata.bitrate != null && metadata.bitrate > 0 && (
            <span>
              {metadata.duration != null && metadata.duration > 0 && metadata.fileSize > 0
                ? `估算码率: ${(metadata.bitrate / 1000000).toFixed(2)} Mbps`
                : `码率: ${(metadata.bitrate / 1000000).toFixed(2)} Mbps`}
            </span>
          )}
          {/* 音频元数据 */}
          {resourceType === 'audio' && metadata.sampleRate != null && metadata.sampleRate > 0 && (
            <span>采样率: {(metadata.sampleRate / 1000).toFixed(1)} kHz</span>
          )}
          {resourceType === 'audio' && metadata.channels != null && (
            <span>声道: {metadata.channels === 1 ? '单声道' : metadata.channels === 2 ? '立体声' : `${metadata.channels}声道`}</span>
          )}
          {resourceType === 'audio' && metadata.audioBitrate != null && metadata.audioBitrate > 0 && (
            <span>码率: {(metadata.audioBitrate / 1000).toFixed(0)} kbps</span>
          )}
        </Space>
      </div>
    );
  };

  // 提取输入和输出资源 URL
  const inputUrls = extractUrls(task.requestPayload);
  const outputUrls = extractUrls(task.resultPayload);
  const canRefreshResourceMetadata = TASK_TERMINAL_STATUSES.has(String(task.status));

  const renderResourceMetadataExtra = () => (
    <Tooltip
      title={
        canRefreshResourceMetadata
          ? '后台重新拉取该任务资源元数据，完成后请点击顶部「刷新」查看最新结果'
          : '仅终态任务（成功 / 失败 / 超时 / 已取消）支持异步重拉资源元数据'
      }
    >
      <Button
        type="link"
        size="small"
        loading={refreshing}
        disabled={!canRefreshResourceMetadata}
        onClick={() => reloadTaskData({ mode: 'manual', refreshResourceMetadata: true })}
      >
        重拉元数据
      </Button>
    </Tooltip>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
            返回
          </Button>
          {canMutateTask && (task.status === 'PENDING' || task.status === 'SUBMITTED') && (
            <Popconfirm
              title="确认取消该任务？"
              onConfirm={handleCancel}
              okText="确认"
              cancelText="取消"
            >
              <Button danger icon={<StopOutlined />}>取消任务</Button>
            </Popconfirm>
          )}
        </Space>
        <Space wrap>
          <Tooltip title="重新拉取任务详情、时间线与时长指标（PROCESSING 任务可多次点击查看最新状态）">
            <Button
              loading={refreshing}
              onClick={() => reloadTaskData({ mode: 'manual' })}
            >
              刷新
            </Button>
          </Tooltip>
          {canMutateTask && task.callback?.url && (
            <Button icon={<RedoOutlined />} onClick={handleReplay}>重放回调</Button>
          )}
        </Space>
      </div>

      <Card title="基础信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
          <Descriptions.Item label="TaskId">{task.taskId}</Descriptions.Item>
          <Descriptions.Item label="状态"><StatusTag status={task.status} /></Descriptions.Item>
          <Descriptions.Item label="模型">
            {canReadModel ? (
              <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={openModelModal}>
                {task.model} <InfoCircleOutlined />
              </Button>
            ) : (
              task.model
            )}
          </Descriptions.Item>
          <Descriptions.Item label="厂商"><Tag>{task.provider}</Tag></Descriptions.Item>
          <Descriptions.Item label="功能类型">{task.featureType}</Descriptions.Item>
          {task.clientId && (
            <Descriptions.Item label="clientId">{task.clientId}</Descriptions.Item>
          )}
          {task.clientId && (
            <Descriptions.Item label="客户端名称">{task.clientName || '—'}</Descriptions.Item>
          )}
          <Descriptions.Item label="优先级">
            {task.priority != null
              ? <>{task.priority} <Tag color={priorityToLabel(task.priority).color}>{priorityToLabel(task.priority).label}</Tag></>
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDateTime(task.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDateTime(task.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Modal
        title="模型信息"
        open={modelModalOpen}
        onCancel={() => setModelModalOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Spin spinning={modelDetailLoading}>
          {!modelDetail && !modelDetailLoading ? (
            <Typography.Text type="secondary">未找到该模型的配置</Typography.Text>
          ) : modelDetail ? (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="model_name">{modelDetail.model_name}</Descriptions.Item>
              <Descriptions.Item label="label">{modelDetail.label}</Descriptions.Item>
              <Descriptions.Item label="provider">{modelDetail.provider}</Descriptions.Item>
              <Descriptions.Item label="provider_model_name">{modelDetail.provider_model_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="model_type">{modelDetail.model_type}</Descriptions.Item>
              <Descriptions.Item label="service">{modelDetail.service || '—'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {modelDetail.disabled ? <Tag color="red">已禁用</Tag> : <Tag color="green">启用</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="unit_price_map">
                <Typography.Paragraph copyable style={{ marginBottom: 0, fontSize: 12 }}>
                  {modelDetail.unit_price_map && Object.keys(modelDetail.unit_price_map).length > 0
                    ? JSON.stringify(modelDetail.unit_price_map, null, 2)
                    : '—'}
                </Typography.Paragraph>
              </Descriptions.Item>
            </Descriptions>
          ) : null}
        </Spin>
      </Modal>

      {timing && (
        <Card title="时长指标" style={{ marginBottom: 16 }}>
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} bordered size="small">
            <Descriptions.Item label="排队等待">{formatMs(timing.queueWaitMs)}</Descriptions.Item>
            <Descriptions.Item label="厂商处理">{formatMs(timing.providerProcessMs)}</Descriptions.Item>
            <Descriptions.Item label="端到端总时长">{formatMs(timing.totalE2eMs)}</Descriptions.Item>
            <Descriptions.Item label="回调延迟">{formatMs(timing.callbackDelayMs)}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {task.billing && (
        <Card title={<><DollarOutlined /> 计费信息</>} style={{ marginBottom: 16 }}>
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
            <Descriptions.Item label="计费状态">
              <Tag color={BILLING_STATUS_MAP[task.billing.status]?.color || 'default'}>
                {BILLING_STATUS_MAP[task.billing.status]?.label || task.billing.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="计费策略">
              <Tag color={BILLING_POLICY_MAP[task.billing.billingPolicy]?.color || 'default'}>
                {BILLING_POLICY_MAP[task.billing.billingPolicy]?.label || task.billing.billingPolicy}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="用量类型">
              {USAGE_TYPE_MAP[task.billing.usageType] || task.billing.usageType}
            </Descriptions.Item>
            <Descriptions.Item label="unit_price_map 命中">{task.billing.unitPriceTierUsed ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="单价">
                {task.billing.unitPrice} {task.billing.currency}
                {billingUsageSuffix(task.billing.usageType)
                  ? ` / ${billingUsageSuffix(task.billing.usageType)}`
                  : ''}
              </Descriptions.Item>
              <Descriptions.Item label="预估用量">
                {formatBillingUsageValue(task.billing.estimatedUsage, task.billing.usageType)}
              </Descriptions.Item>
              <Descriptions.Item label="预估费用">{task.billing.estimatedCost} {task.billing.currency}</Descriptions.Item>
              {task.billing.actualUsage !== undefined && task.billing.actualUsage !== null && (
                <Descriptions.Item label="实际用量">
                  {formatBillingUsageValue(task.billing.actualUsage, task.billing.usageType)}
                </Descriptions.Item>
              )}
              {(task.billing.actualCost !== undefined && task.billing.actualCost !== null) && (
                <Descriptions.Item label="实际费用">
                  <Typography.Text strong>{task.billing.actualCost} {task.billing.currency}</Typography.Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="实际收益（$）">{formatUsd(task.billing.actualRevenueUsd)}</Descriptions.Item>
              <Descriptions.Item label="实际成本（$）">{formatUsd(task.billing.providerCostUsd)}</Descriptions.Item>
              <Descriptions.Item
                label={
                  <Space size={6}>
                    毛利（$）
                    <Tooltip title="计算公式：毛利（$）= 实际收益（$）− 实际成本（$）。实际收益按「命中档位 sale_unit_price（$/credit）× 实际费用(credit)」计算，实际成本按「命中档位 cost_unit_price × 实际用量」计算。">
                      <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                }
              >
                {formatUsd(task.billing.grossProfitUsd)}
              </Descriptions.Item>
              <Descriptions.Item
                label={
                  <Space size={6}>
                    利润率
                    <Tooltip title={(
                      <span>
                        计算公式：利润率 = 毛利（$）÷ 实际收益（$）× 100%。仅在实际收益（$）与毛利（$）均已算出且实际收益（$）≠ 0 时展示。
                      </span>
                    )}
                    >
                      <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                }
              >
                {task.billing.profitMarginPercent != null ? (
                  <Typography.Text type={task.billing.profitMarginPercent < 0 ? 'danger' : undefined}>
                    {task.billing.profitMarginPercent}%
                  </Typography.Text>
                ) : '—'}
              </Descriptions.Item>
            {task.billing.settledAt && (
              <Descriptions.Item label="结算时间">{formatDateTime(task.billing.settledAt)}</Descriptions.Item>
            )}
            {task.billing.refundedAt && (
              <Descriptions.Item label="退款时间">{formatDateTime(task.billing.refundedAt)}</Descriptions.Item>
            )}
            {task.billing.failReason && (
              <Descriptions.Item label="失败原因">
                <Typography.Text type="danger">{task.billing.failReason}</Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}

      {/* 资源预览 */}
      {(inputUrls.length > 0 || outputUrls.length > 0) && (
        <Card title="资源信息" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            {/* 输入资源 */}
            {inputUrls.length > 0 && (
              <Col xs={24} lg={outputUrls.length > 0 ? 12 : 24}>
                <Card type="inner" title="输入资源" size="small" extra={renderResourceMetadataExtra()}>
                  {inputUrls.map(({ key, url }) => {
                    const resourceType = getResourceType(url);
                    return (
                      <div key={key} style={{ marginBottom: 16 }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Space>
                            {RESOURCE_TYPE_ICON[resourceType] || <LinkOutlined />}
                            <Tooltip title={url}>
                              <Typography.Text copyable ellipsis style={{ maxWidth: 400 }}>
                                {url}
                              </Typography.Text>
                            </Tooltip>
                          </Space>
                          {renderResourcePreview(url, resourceType)}
                          {renderMetadata(url, resourceType)}
                        </Space>
                      </div>
                    );
                  })}
                </Card>
              </Col>
            )}

            {/* 输出资源 */}
            {outputUrls.length > 0 && (
              <Col xs={24} lg={inputUrls.length > 0 ? 12 : 24}>
                <Card type="inner" title="输出资源" size="small" extra={renderResourceMetadataExtra()}>
                  {outputUrls.map(({ key, url }) => {
                    const resourceType = getResourceType(url);
                    return (
                      <div key={key} style={{ marginBottom: 16 }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Space>
                            {RESOURCE_TYPE_ICON[resourceType] || <LinkOutlined />}
                            <Tooltip title={url}>
                              <Typography.Text copyable ellipsis style={{ maxWidth: 400 }}>
                                {url}
                              </Typography.Text>
                            </Tooltip>
                            <Button
                              type="link"
                              size="small"
                              icon={<DownloadOutlined />}
                              href={url}
                              target="_blank"
                            />
                          </Space>
                          {renderResourcePreview(url, resourceType)}
                          {renderMetadata(url, resourceType)}
                        </Space>
                      </div>
                    );
                  })}
                </Card>
              </Col>
            )}
          </Row>
        </Card>
      )}

      {timeline.length > 0 && (
        <Card title="任务时间线">
          <Steps
            direction="vertical" size="small" current={timeline.length - 1}
            items={timeline.map((e: any) => ({
              title: TIMELINE_EVENT_LABELS[e.event] || e.event,
              description: (
                <div>
                  <Typography.Text type="secondary">{formatDateTime(e.timestamp)}</Typography.Text>
                  {e.durationFromPrev > 0 && <Tag style={{ marginLeft: 8 }}>距上一步 +{e.durationFromPrev} ms</Tag>}
                  {e.detail && Object.keys(e.detail).length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '8px 10px',
                        background: '#fafafa',
                        borderRadius: 6,
                        fontSize: 13,
                      }}
                    >
                      {formatTimelineDetailValue(e.detail)}
                    </div>
                  )}
                </div>
              ),
              status: e.event.includes('FAIL') || e.event.includes('TIMEOUT') || e.event.includes('DEAD_LETTER')
                ? 'error' as const
                : e.event.includes('SUCCESS') || e.event.includes('_OK') ? 'finish' as const
                : 'process' as const,
            }))}
          />
        </Card>
      )}

      {task.error && (
        <>
          <Divider />
          <Card title="错误信息" style={{ borderColor: '#ff4d4f' }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="错误码">{task.error.code}</Descriptions.Item>
              <Descriptions.Item label="错误信息">{task.error.message}</Descriptions.Item>
              {task.error.providerCode && <Descriptions.Item label="厂商错误码">{task.error.providerCode}</Descriptions.Item>}
            </Descriptions>
          </Card>
        </>
      )}
    </div>
  );
}
