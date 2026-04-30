import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Steps, Button, Space, Typography, Spin, message, Tag, Divider, Popconfirm } from 'antd';
import { ArrowLeftOutlined, RedoOutlined, StopOutlined } from '@ant-design/icons';
import StatusTag from '../components/StatusTag';
import { taskApi } from '../services/api';
import { priorityToLabel, formatDateTime } from '../utils/format-helpers';

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
