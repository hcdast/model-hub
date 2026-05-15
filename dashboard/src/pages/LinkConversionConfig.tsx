import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { linkConversionConfigApi, type LinkConversionConfigPayload } from '../services/api';
import { useAuthStore } from '../store/auth';
import PageHeader from '../components/PageHeader';

const BYTES_PER_MB = 1024 * 1024;

function configToFormValues(c: LinkConversionConfigPayload) {
  return {
    enabled: c.enabled,
    timeout_download_ms: c.timeout.download_ms,
    timeout_upload_ms: c.timeout.upload_ms,
    timeout_total_ms: c.timeout.total_ms,
    domain_whitelist: c.domain_whitelist,
    resource_allowed_types: c.resource_filters.allowed_types,
    max_image_mb: c.resource_filters.max_size_bytes.image / BYTES_PER_MB,
    max_video_mb: c.resource_filters.max_size_bytes.video / BYTES_PER_MB,
    max_audio_mb: c.resource_filters.max_size_bytes.audio / BYTES_PER_MB,
    storage_bucket: c.storage_config.bucket,
    storage_path_prefix: c.storage_config.path_prefix,
    storage_biz_type: c.storage_config.biz_type ?? '',
    storagesvc_host: c.storagesvc?.host ?? '',
    storagesvc_jwt_secret: c.storagesvc?.jwt_secret ?? '',
    storagesvc_timeout_ms: c.storagesvc?.timeout_ms ?? 10_000,
    failure_policy: c.failure_policy,
    retry_max_attempts: c.retry_config.max_attempts,
    retry_backoff_factor: c.retry_config.backoff_factor,
    retry_initial_delay_ms: c.retry_config.initial_delay_ms,
    monitoring_failure_rate: c.monitoring.failure_rate_threshold,
    alert_channels: c.monitoring.alert_channels,
    alert_recipients: c.monitoring.alert_recipients,
  };
}

function formValuesToPayload(v: Record<string, unknown>): LinkConversionConfigPayload {
  return {
    enabled: Boolean(v.enabled),
    timeout: {
      download_ms: Number(v.timeout_download_ms),
      upload_ms: Number(v.timeout_upload_ms),
      total_ms: Number(v.timeout_total_ms),
    },
    domain_whitelist: (v.domain_whitelist as string[]) || [],
    resource_filters: {
      allowed_types: (v.resource_allowed_types as string[]) || [],
      max_size_bytes: {
        image: Math.round(Number(v.max_image_mb) * BYTES_PER_MB),
        video: Math.round(Number(v.max_video_mb) * BYTES_PER_MB),
        audio: Math.round(Number(v.max_audio_mb) * BYTES_PER_MB),
      },
    },
    storage_config: {
      bucket: String(v.storage_bucket || '').trim(),
      path_prefix: String(v.storage_path_prefix || '').trim(),
      ...(String(v.storage_biz_type || '').trim()
        ? { biz_type: String(v.storage_biz_type).trim() }
        : {}),
    },
    storagesvc: {
      host: String(v.storagesvc_host || '').trim(),
      jwt_secret: String(v.storagesvc_jwt_secret || '').trim(),
      timeout_ms: Number(v.storagesvc_timeout_ms) || 10_000,
    },
    failure_policy: v.failure_policy as 'fail_fast' | 'use_original',
    retry_config: {
      max_attempts: Number(v.retry_max_attempts),
      backoff_factor: Number(v.retry_backoff_factor),
      initial_delay_ms: Number(v.retry_initial_delay_ms),
    },
    monitoring: {
      failure_rate_threshold: Number(v.monitoring_failure_rate),
      alert_channels: (v.alert_channels as string[]) || [],
      alert_recipients: (v.alert_recipients as string[]) || [],
    },
  };
}

export default function LinkConversionConfigPage() {
  const [form] = Form.useForm();
  const { permissions, roles } = useAuthStore();
  const canUpdate =
    roles.includes('super_admin') ||
    permissions.includes('*') ||
    permissions.includes('link-conversion:update');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [cacheTtlMs, setCacheTtlMs] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await linkConversionConfigApi.get({ fresh: true });
      const data = res.data;
      if (data?.config) {
        form.setFieldsValue(configToFormValues(data.config as LinkConversionConfigPayload));
        setRevision(data.revision ?? 0);
        setCacheTtlMs(data.cache_ttl_ms ?? null);
      }
    } catch {
      message.error('加载请求转换配置失败');
    }
    setLoading(false);
  }, [form]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const payload = formValuesToPayload(v);
      const res: any = await linkConversionConfigApi.update(payload);
      message.success(`已保存（revision ${res.data?.revision ?? ''}）`);
      setRevision(res.data?.revision ?? revision);
      await load();
    } catch (e: any) {
      if (e?.errorFields) return;
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        (typeof e === 'string' ? e : '保存失败');
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="请求转换配置"
        extra={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void submit()}
              loading={saving}
              disabled={!canUpdate}
            >
              保存
            </Button>
          </>
        )}
      />
      <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="配置说明"
        description={(
          <span>
            对应需求文档「需求 2」：可配置开关、超时、域名白名单、资源类型与大小、存储路径、失败策略等。
            {cacheTtlMs != null && (
              <span>
                {' '}
                运行时读取配置带有最长约 {Math.round(cacheTtlMs / 1000)} 秒的进程内缓存；保存后会立即失效本实例缓存，多实例部署下各节点会在该时间窗口内陆续对齐。
              </span>
            )}
            {revision > 0 && <span> 当前 revision：{revision}。</span>}
          </span>
        )}
      />

      <Form
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={{
          enabled: false,
          failure_policy: 'use_original',
          resource_allowed_types: ['image/*', 'video/*', 'audio/*'],
          alert_channels: [],
          alert_recipients: [],
        }}
      >
        <Typography.Title level={5}>基础</Typography.Title>
        <Form.Item
          name="enabled"
          label="启用请求转换"
          valuePropName="checked"
        >
          <Switch checkedChildren="开" unCheckedChildren="关" />
        </Form.Item>

        <Typography.Title level={5}>超时（毫秒）</Typography.Title>
        <Space wrap>
          <Form.Item
            name="timeout_download_ms"
            label="下载超时"
            rules={[{ required: true, message: '必填' }]}
          >
            <InputNumber min={1000} max={3600000} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="timeout_upload_ms"
            label="上传超时"
            rules={[{ required: true, message: '必填' }]}
          >
            <InputNumber min={1000} max={3600000} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="timeout_total_ms"
            label="整体转换超时"
            rules={[{ required: true, message: '必填' }]}
          >
            <InputNumber min={1000} max={3600000} style={{ width: 160 }} />
          </Form.Item>
        </Space>

        <Divider />
        <Typography.Title level={5}>安全与过滤</Typography.Title>
        <Form.Item
          name="domain_whitelist"
          label="第三方域名白名单（启用时至少一项；支持 *.example.com）"
          rules={[{ required: false }]}
        >
          <Select mode="tags" placeholder="输入后回车添加" style={{ width: '100%' }} tokenSeparators={[',', ' ']} />
        </Form.Item>
        <Form.Item
          name="resource_allowed_types"
          label="资源类型（MIME 模式，如 image/*）"
          rules={[{ required: true, message: '至少一种类型' }]}
        >
          <Select mode="tags" style={{ width: '100%' }} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="max_image_mb" label="图片最大（MB）" rules={[{ required: true }]}>
            <InputNumber min={1} max={16384} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="max_video_mb" label="视频最大（MB）" rules={[{ required: true }]}>
            <InputNumber min={1} max={16384} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="max_audio_mb" label="音频最大（MB）" rules={[{ required: true }]}>
            <InputNumber min={1} max={16384} style={{ width: 140 }} />
          </Form.Item>
        </Space>

        <Divider />
        <Typography.Title level={5}>存储参数</Typography.Title>
        <Form.Item name="storage_bucket" label="存储桶 bucket" rules={[{ required: true }]}>
          <Input placeholder="例如 model-hub-resources" />
        </Form.Item>
        <Form.Item name="storage_path_prefix" label="路径前缀 path_prefix" rules={[{ required: true }]}>
          <Input placeholder="例如 third-party-converted/" />
        </Form.Item>
        <Form.Item
          name="storage_biz_type"
          label="存储业务类型 biz_type（可选，对应 storagesvc generateSignature）"
        >
          <Input placeholder="默认 model-hub-link-conversion" allowClear />
        </Form.Item>

        <Divider />
        <Typography.Title level={5}>存储网关 storagesvc（@akool-sdk/storage）</Typography.Title>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="启用请求转换时须填写网关地址与 JWT 密钥；与 AGI-Content-Job 的 storagesvc 配置含义一致。"
        />
        <Form.Item
          name="storagesvc_host"
          label="网关地址 host（baseUrl）"
          rules={[{ required: false }]}
        >
          <Input placeholder="例如 https://storage-gateway.example.com" />
        </Form.Item>
        <Form.Item
          name="storagesvc_jwt_secret"
          label="JWT 密钥 jwt_secret"
          rules={[{ required: false }]}
        >
          <Input.Password placeholder="启用请求转换时必填" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="storagesvc_timeout_ms"
          label="SDK 请求超时（毫秒）"
          rules={[{ required: true }]}
        >
          <InputNumber min={1000} max={120000} style={{ width: 200 }} />
        </Form.Item>

        <Divider />
        <Typography.Title level={5}>失败与重试</Typography.Title>
        <Form.Item name="failure_policy" label="转换失败策略">
          <Radio.Group>
            <Radio value="fail_fast">直接失败（不返回链接）</Radio>
            <Radio value="use_original">使用原始第三方链接</Radio>
          </Radio.Group>
        </Form.Item>
        <Space wrap>
          <Form.Item name="retry_max_attempts" label="最大重试次数" rules={[{ required: true }]}>
            <InputNumber min={1} max={20} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="retry_backoff_factor" label="退避倍数" rules={[{ required: true }]}>
            <InputNumber min={1} max={10} step={0.5} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="retry_initial_delay_ms" label="首次重试间隔（毫秒）" rules={[{ required: true }]}>
            <InputNumber min={0} max={300000} style={{ width: 180 }} />
          </Form.Item>
        </Space>

        <Divider />
        <Typography.Title level={5}>监控告警（阈值）</Typography.Title>
        <Form.Item
          name="monitoring_failure_rate"
          label="失败率告警阈值（0～1，如 0.05 表示 5%）"
          rules={[{ required: true }]}
        >
          <InputNumber min={0} max={1} step={0.01} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="alert_channels" label="告警渠道（预留，如 email、slack）">
          <Select mode="tags" style={{ width: '100%' }} placeholder="可选" />
        </Form.Item>
        <Form.Item name="alert_recipients" label="告警接收人/地址">
          <Select mode="tags" style={{ width: '100%' }} placeholder="邮箱或 webhook 等" />
        </Form.Item>
      </Form>
    </Card>
    </div>
  );
}
