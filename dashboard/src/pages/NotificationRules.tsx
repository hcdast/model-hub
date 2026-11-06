import Table from '../components/AdminTable';
import { NOTIFICATION_EVENTS as EVENT_TYPES, EVENT_LABELS, SEVERITY_LABELS } from '../constants/notification-events';
import { useRequest } from '../hooks/useRequest';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Card, Button, Space, Tag, Modal, Form, Input, Select,
  Switch, InputNumber, message, Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { notificationRuleApi } from '../services/api';
import { usePermission } from '../hooks/usePermission';

const SEVERITIES = ['info', 'warning', 'critical'];
const CHANNEL_TYPES = [
  { value: 'wecom', label: '企业微信' },
  { value: 'email', label: '邮件' },
  { value: 'in_app', label: '消息中心' },
];

const severityColor: Record<string, string> = { info: 'blue', warning: 'orange', critical: 'red' };
const channelColor: Record<string, string> = { wecom: 'green', email: 'purple', in_app: 'cyan' };

export default function NotificationRulesPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('notification:create');
  const canUpdate = hasPermission('notification:update');
  const canDelete = hasPermission('notification:delete');
  const [channel, setChannel] = useState<string>(); const [enabled, setEnabled] = useState<string>();
  const { data = [], loading, refresh: fetchData } = useRequest<any[]>(async () => (await notificationRuleApi.list({ channelType: channel, enabled }) as any).data.items, { deps: [channel, enabled] });
  const [modalOpen, setModalOpen] = useState(false); const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true, channelType: 'wecom', eventTypes: [], severities: [], recipients: [], cooldownSeconds: 0, maxCountPerWindow: 0, aggregationSeconds: 0 });
    setModalOpen(true);
  };

  const openEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      cooldownSeconds: (record.cooldownMs || 0) / 1000,
      aggregationSeconds: (record.aggregationWindowMs || 0) / 1000,
      recipients: record.recipients || [],
      webhookUrl: '',
      smtpHost: record.channelConfig?.smtpHost || '',
      smtpPort: record.channelConfig?.smtpPort || '',
      smtpUser: record.channelConfig?.smtpUser || '',
      smtpPass: '',
      from: record.channelConfig?.from || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const channelConfig: Record<string, any> = {};
      if (values.channelType === 'wecom') {
        channelConfig.webhookUrl = values.webhookUrl;
      } else if (values.channelType === 'email') {
        channelConfig.smtpHost = values.smtpHost;
        channelConfig.smtpPort = values.smtpPort;
        channelConfig.smtpUser = values.smtpUser;
        channelConfig.smtpPass = values.smtpPass;
        channelConfig.from = values.from;
      }
      const payload = {
        name: values.name,
        enabled: values.enabled,
        eventTypes: values.eventTypes || [],
        severities: values.severities || [],
        channelType: values.channelType,
        channelConfig,
        recipients: values.recipients || [],
        cooldownMs: Math.round((values.cooldownSeconds || 0) * 1000),
        maxCountPerWindow: values.maxCountPerWindow || 0,
        aggregationWindowMs: Math.round((values.aggregationSeconds || 0) * 1000),
      };
      if (editing) {
        await notificationRuleApi.update(editing._id, payload);
        message.success('更新成功');
      } else {
        await notificationRuleApi.create(payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch (err: any) {
      if (err?.response?.data?.message) message.error(err.response.data.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await notificationRuleApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch { message.error('删除失败'); }
  };

  const channelType = Form.useWatch('channelType', form);

  const columns = [
    { title: '规则名称', dataIndex: 'name', width: 180 },
    { title: '状态', dataIndex: 'enabled', width: 80, render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag> },
    { title: '事件类型', dataIndex: 'eventTypes', width: 220, render: (v: string[]) => v?.length ? v.map((t) => <Tag key={t}>{EVENT_LABELS[t] || t}</Tag>) : <Tag>全部</Tag> },
    { title: '严重级别', dataIndex: 'severities', width: 160, render: (v: string[]) => v?.length ? v.map((s) => <Tag key={s} color={severityColor[s]}>{SEVERITY_LABELS[s] || s}</Tag>) : <Tag>全部</Tag> },
    { title: '渠道', dataIndex: 'channelType', width: 100, render: (v: string) => <Tag color={channelColor[v]}>{CHANNEL_TYPES.find((c) => c.value === v)?.label || v}</Tag> },
    { title: '接收者', dataIndex: 'recipients', width: 160, ellipsis: true, render: (v: string[]) => v?.join(', ') || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', width: 230, render: (_: any, record: any) => (
        <Space>
          {canUpdate && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          )}
          {canUpdate && <Popconfirm title="向此规则保存的接收者发送一条测试通知？" description="此操作会实际发送；不会在保存规则时自动执行。" onConfirm={async () => { const r: any = await notificationRuleApi.test(record._id); Modal.info({ title: '测试通知已入队', content: <Space direction="vertical"><span>测试编号：{r.data.testId}</span><Link to="/notification-records">查看投递记录</Link></Space> }); }}><Button type="link" size="small">测试发送</Button></Popconfirm>}
          {canDelete && (
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record._id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="通知规则"
        leftExtra={canCreate ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
        ) : undefined}
        extra={<Space><Select allowClear placeholder="渠道" value={channel} onChange={setChannel} options={CHANNEL_TYPES} style={{ width: 120 }} /><Select allowClear placeholder="启停" value={enabled} onChange={setEnabled} options={[{ value: 'true', label: '启用' }, { value: 'false', label: '禁用' }]} style={{ width: 100 }} /><Button icon={<ReloadOutlined />} onClick={() => void fetchData()}>刷新</Button></Space>}
      />
      <Card>
        <Table columns={columns} dataSource={data} rowKey="_id" loading={loading} size="small" pagination={false} />
      </Card>

      <Modal title={editing ? '编辑规则' : '新建规则'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} confirmLoading={saving} width={640} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如：任务失败告警" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="eventTypes" label="事件类型（留空匹配全部）">
            <Select mode="multiple" options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_LABELS[t] || t }))} placeholder="选择事件类型" allowClear />
          </Form.Item>
          <Form.Item name="severities" label="严重级别（留空匹配全部）">
            <Select mode="multiple" options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] || s }))} placeholder="选择级别" allowClear />
          </Form.Item>
          <Form.Item name="channelType" label="通知渠道" rules={[{ required: true }]}>
            <Select options={CHANNEL_TYPES} />
          </Form.Item>
          {channelType === 'wecom' && (
            <Form.Item name="webhookUrl" label="Webhook URL" rules={[{ required: !editing?.secretsConfigured?.webhookUrl, message: '请输入 Webhook URL' }]}>
              <Input placeholder={editing?.secretsConfigured?.webhookUrl ? '已配置；留空保留原值' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'} />
            </Form.Item>
          )}
          {channelType === 'email' && (
            <>
              <Form.Item name="smtpHost" label="SMTP Host" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="smtpPort" label="SMTP Port" rules={[{ required: true }]}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="smtpUser" label="SMTP User" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="smtpPass" label="SMTP 密码（只写，留空保留）" rules={[{ required: !editing?.secretsConfigured?.smtpPass }]}><Input.Password /></Form.Item>
              <Form.Item name="from" label="发件人" rules={[{ required: true }]}><Input /></Form.Item>
            </>
          )}
          <Form.Item name="recipients" label="接收者">
            <Select mode="tags" placeholder="输入邮箱或用户ID后回车" />
          </Form.Item>
          <Form.Item name="cooldownSeconds" label="冷却期（秒）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="maxCountPerWindow" label="窗口内最大通知数"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="aggregationSeconds" label="聚合窗口（秒）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
