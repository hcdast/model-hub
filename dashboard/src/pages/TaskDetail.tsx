import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Steps, Button, Space, Typography, Spin, message, Tag, Divider, Popconfirm, Row, Col, Tooltip, Image } from 'antd';
import { ArrowLeftOutlined, RedoOutlined, StopOutlined, DollarOutlined, PictureOutlined, VideoCameraOutlined, AudioOutlined, LinkOutlined, DownloadOutlined } from '@ant-design/icons';
import StatusTag from '../components/StatusTag';
import { taskApi } from '../services/api';
import { priorityToLabel, formatDateTime } from '../utils/format-helpers';

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

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [timing, setTiming] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) return;
    Promise.all([
      taskApi.get(taskId),
      taskApi.getTimeline(taskId),
      taskApi.getTiming(taskId),
    ]).then(([t, tl, tm]: any[]) => {
      setTask(t.data);
      setTimeline(tl.data?.timeline || []);
      setTiming(tm.data?.timing);
    }).finally(() => setLoading(false));
  }, [taskId]);

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
      // Refresh task data
      const res: any = await taskApi.get(taskId!);
      setTask(res.data);
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
            <span>编码: {metadata.codec}</span>
          )}
          {resourceType === 'video' && metadata.bitrate != null && metadata.bitrate > 0 && (
            <span>码率: {(metadata.bitrate / 1000000).toFixed(1)} Mbps</span>
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

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tasks')}>返回</Button>
        {task.callback?.url && (
          <Button icon={<RedoOutlined />} onClick={handleReplay}>重放回调</Button>
        )}
        {(task.status === 'PENDING' || task.status === 'SUBMITTED') && (
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

      <Card title="基础信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
          <Descriptions.Item label="TaskId">{task.taskId}</Descriptions.Item>
          {task.clientId && (
            <>
              <Descriptions.Item label="clientId">{task.clientId}</Descriptions.Item>
              <Descriptions.Item label="客户端名称">{task.clientName || '—'}</Descriptions.Item>
            </>
          )}
          <Descriptions.Item label="状态"><StatusTag status={task.status} /></Descriptions.Item>
          <Descriptions.Item label="模型">{task.model}</Descriptions.Item>
          <Descriptions.Item label="厂商"><Tag>{task.provider}</Tag></Descriptions.Item>
          <Descriptions.Item label="功能类型">{task.featureType}</Descriptions.Item>
          <Descriptions.Item label="优先级">
            {task.priority != null
              ? <>{task.priority} <Tag color={priorityToLabel(task.priority).color}>{priorityToLabel(task.priority).label}</Tag></>
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDateTime(task.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDateTime(task.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

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
            <Descriptions.Item label="单价">{task.billing.unitPrice} {task.billing.currency}</Descriptions.Item>
            <Descriptions.Item label="预估用量">{task.billing.estimatedUsage}</Descriptions.Item>
            <Descriptions.Item label="预估费用">{task.billing.estimatedCost} {task.billing.currency}</Descriptions.Item>
            {task.billing.actualUsage !== undefined && task.billing.actualUsage !== null && (
              <Descriptions.Item label="实际用量">{task.billing.actualUsage}</Descriptions.Item>
            )}
            {task.billing.actualCost !== undefined && task.billing.actualCost !== null && (
              <Descriptions.Item label="实际费用">
                <Typography.Text strong>{task.billing.actualCost} {task.billing.currency}</Typography.Text>
              </Descriptions.Item>
            )}
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
                <Card type="inner" title="输入资源" size="small">
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
                <Card type="inner" title="输出资源" size="small">
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
              title: e.event,
              description: (
                <div>
                  <Typography.Text type="secondary">{formatDateTime(e.timestamp)}</Typography.Text>
                  {e.durationFromPrev > 0 && <Tag style={{ marginLeft: 8 }}>+{e.durationFromPrev}ms</Tag>}
                  {e.detail && Object.keys(e.detail).length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text code style={{ fontSize: 12 }}>{JSON.stringify(e.detail)}</Typography.Text>
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
