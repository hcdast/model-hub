import { useState, useEffect } from 'react';
import { Button, Input, Table, Tag, Space, Modal, message, Popconfirm, Tooltip, Card, Progress } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CrownOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import tokens from '../theme/dark';
import { apiKeyApi } from '../services/auth-api';

interface ApiKey {
  id: string;
  name: string;
  apiKey: string;
  permissions: string[];
  enabled: boolean;
  rateLimit?: {
    maxQps?: number;
    maxDailyRequests?: number;
  };
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

interface UserLimits {
  role: string;
  roleDisplayName: string;
  apiKey: {
    currentCount: number;
    maxCount: number;
    canCreate: boolean;
    defaultQps: number;
    maxQps: number;
    defaultDailyRequests: number;
    maxDailyRequests: number;
  };
  workflow: {
    maxCount: number;
    maxNodesPerWorkflow: number;
    maxConcurrentRuns: number;
    executionTimeout: number;
  };
  features: Record<string, boolean>;
  priority: number;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [limits, setLimits] = useState<UserLimits | null>(null);

  useEffect(() => {
    fetchKeys();
    fetchLimits();
  }, []);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await apiKeyApi.list();
      setKeys(res.data || []);
    } catch (err) {
      message.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  const fetchLimits = async () => {
    try {
      const res = await apiKeyApi.getLimits();
      setLimits(res.data);
    } catch (err) {
      // ignore
    }
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      message.warning('Please enter a name');
      return;
    }

    try {
      const res = await apiKeyApi.create({ name: newKeyName });
      setCreatedKey(res.data.apiKey);
      setNewKeyName('');
      fetchKeys();
      fetchLimits(); // 刷新限制信息
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Failed to create API key');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiKeyApi.delete(id);
      message.success('API key deleted');
      fetchKeys();
      fetchLimits(); // 刷新限制信息
    } catch (err) {
      message.error('Failed to delete API key');
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await apiKeyApi.update(id, { enabled });
      message.success(`API key ${enabled ? 'enabled' : 'disabled'}`);
      fetchKeys();
    } catch (err) {
      message.error('Failed to update API key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    message.success('Copied to clipboard');
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      user: tokens.text.tertiary,
      vip: '#f59e0b',
      admin: tokens.accent.primary,
    };
    return colors[role] || tokens.text.tertiary;
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <span style={{ color: tokens.text.primary, fontWeight: tokens.font.weight.medium }}>
          {name}
        </span>
      ),
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      render: (apiKey: string) => (
        <Space>
          <code style={{
            padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
            background: tokens.bg.secondary,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.font.size.sm,
            color: tokens.text.secondary,
          }}>
            {apiKey}
          </code>
          {apiKey !== '****' && (
            <Tooltip title="Copy">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(apiKey)}
                style={{ color: tokens.text.tertiary }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Rate Limit',
      key: 'rateLimit',
      render: (_: any, record: ApiKey) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: tokens.font.size.sm, color: tokens.text.secondary }}>
            QPS: {record.rateLimit?.maxQps || limits?.apiKey.defaultQps || 10}
          </span>
          <span style={{ fontSize: tokens.font.size.sm, color: tokens.text.tertiary }}>
            Daily: {(record.rateLimit?.maxDailyRequests || limits?.apiKey.defaultDailyRequests || 1000).toLocaleString()}
          </span>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean, record: ApiKey) => (
        <Tag
          color={enabled ? tokens.status.success : tokens.text.tertiary}
          style={{
            background: enabled ? `${tokens.status.success}20` : `${tokens.text.tertiary}20`,
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={() => handleToggle(record.id, !enabled)}
        >
          {enabled ? 'Active' : 'Disabled'}
        </Tag>
      ),
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: (date: string) => (
        <span style={{ color: tokens.text.tertiary }}>
          {date ? new Date(date).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => (
        <span style={{ color: tokens.text.tertiary }}>
          {new Date(date).toLocaleDateString()}
        </span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: ApiKey) => (
        <Popconfirm
          title="Are you sure you want to delete this API key?"
          description="This action cannot be undone."
          onConfirm={() => handleDelete(record.id)}
          okText="Delete"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
          >
            Delete
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: tokens.spacing.xl,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: tokens.spacing.xl,
      }}>
        <div>
          <h1 style={{
            fontSize: tokens.font.size.xxl,
            fontWeight: tokens.font.weight.semibold,
            color: tokens.text.primary,
            marginBottom: tokens.spacing.sm,
          }}>
            API Keys
          </h1>
          <p style={{
            fontSize: tokens.font.size.base,
            color: tokens.text.secondary,
          }}>
            Manage your API keys for programmatic access
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setShowCreateModal(true)}
          disabled={limits ? !limits.apiKey.canCreate : false}
          style={{
            background: tokens.accent.gradient,
            border: 'none',
          }}
        >
          Create API Key
        </Button>
      </div>

      {/* 用户角色和限制信息 */}
      {limits && (
        <Card
          style={{
            background: tokens.bg.tertiary,
            borderColor: tokens.border.default,
            marginBottom: tokens.spacing.xl,
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: tokens.spacing.lg,
          }}>
            <Space>
              <CrownOutlined style={{ color: getRoleColor(limits.role), fontSize: 20 }} />
              <span style={{
                fontSize: tokens.font.size.lg,
                fontWeight: tokens.font.weight.semibold,
                color: tokens.text.primary,
              }}>
                {limits.roleDisplayName}
              </span>
              <Tag color={getRoleColor(limits.role)}>
                {limits.role.toUpperCase()}
              </Tag>
            </Space>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: tokens.spacing.xl,
          }}>
            {/* API Key 数量 */}
            <div>
              <div style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
                marginBottom: tokens.spacing.sm,
              }}>
                API Keys
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: tokens.spacing.sm,
              }}>
                <span style={{
                  fontSize: tokens.font.size.xxl,
                  fontWeight: tokens.font.weight.bold,
                  color: tokens.text.primary,
                }}>
                  {limits.apiKey.currentCount}
                </span>
                <span style={{ color: tokens.text.tertiary }}>
                  / {limits.apiKey.maxCount === -1 ? '∞' : limits.apiKey.maxCount}
                </span>
              </div>
              {limits.apiKey.maxCount !== -1 && (
                <Progress
                  percent={Math.round((limits.apiKey.currentCount / limits.apiKey.maxCount) * 100)}
                  size="small"
                  showInfo={false}
                  strokeColor={limits.apiKey.currentCount >= limits.apiKey.maxCount ? tokens.status.error : tokens.accent.primary}
                />
              )}
            </div>

            {/* QPS 限制 */}
            <div>
              <div style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
                marginBottom: tokens.spacing.sm,
              }}>
                <ThunderboltOutlined /> Rate Limit (QPS)
              </div>
              <div style={{
                fontSize: tokens.font.size.xxl,
                fontWeight: tokens.font.weight.bold,
                color: tokens.text.primary,
              }}>
                {limits.apiKey.maxQps === -1 ? '∞' : limits.apiKey.defaultQps}
              </div>
              <div style={{ fontSize: tokens.font.size.sm, color: tokens.text.tertiary }}>
                Max: {limits.apiKey.maxQps === -1 ? 'Unlimited' : limits.apiKey.maxQps}
              </div>
            </div>

            {/* 每日请求数 */}
            <div>
              <div style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
                marginBottom: tokens.spacing.sm,
              }}>
                Daily Requests
              </div>
              <div style={{
                fontSize: tokens.font.size.xxl,
                fontWeight: tokens.font.weight.bold,
                color: tokens.text.primary,
              }}>
                {limits.apiKey.defaultDailyRequests.toLocaleString()}
              </div>
              <div style={{ fontSize: tokens.font.size.sm, color: tokens.text.tertiary }}>
                Max: {limits.apiKey.maxDailyRequests === -1 ? 'Unlimited' : limits.apiKey.maxDailyRequests.toLocaleString()}
              </div>
            </div>

            {/* 优先级 */}
            <div>
              <div style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
                marginBottom: tokens.spacing.sm,
              }}>
                Priority
              </div>
              <div style={{
                fontSize: tokens.font.size.xxl,
                fontWeight: tokens.font.weight.bold,
                color: tokens.text.primary,
              }}>
                {limits.priority}
              </div>
              <div style={{ fontSize: tokens.font.size.sm, color: tokens.text.tertiary }}>
                / 10
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 提示信息 */}
      <div style={{
        padding: tokens.spacing.md,
        marginBottom: tokens.spacing.xl,
        background: `${tokens.accent.primary}10`,
        border: `1px solid ${tokens.accent.primary}30`,
        borderRadius: tokens.radius.md,
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacing.md,
      }}>
        <ExclamationCircleOutlined style={{
          color: tokens.accent.primary,
          marginTop: 2,
        }} />
        <div>
          <div style={{
            fontSize: tokens.font.size.sm,
            color: tokens.text.primary,
            fontWeight: tokens.font.weight.medium,
            marginBottom: tokens.spacing.xs,
          }}>
            About API Keys
          </div>
          <div style={{
            fontSize: tokens.font.size.sm,
            color: tokens.text.secondary,
          }}>
            API keys are used to authenticate your requests to the Workflow Studio API.
            Keep your API keys secure and never share them publicly. Rate limits are applied per key.
          </div>
        </div>
      </div>

      {/* API Key 列表 */}
      <Table
        columns={columns}
        dataSource={keys}
        rowKey="id"
        loading={loading}
        pagination={false}
        style={{
          background: tokens.bg.tertiary,
          borderRadius: tokens.radius.lg,
          overflow: 'hidden',
        }}
      />

      {/* 创建 API Key 弹窗 */}
      <Modal
        title="Create API Key"
        open={showCreateModal}
        onCancel={() => {
          setShowCreateModal(false);
          setCreatedKey(null);
          setNewKeyName('');
        }}
        footer={createdKey ? (
          <Button
            type="primary"
            onClick={() => {
              setShowCreateModal(false);
              setCreatedKey(null);
            }}
          >
            Done
          </Button>
        ) : (
          <Space>
            <Button onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={handleCreate}
              disabled={!newKeyName.trim()}
            >
              Create
            </Button>
          </Space>
        )}
      >
        {createdKey ? (
          <div>
            <div style={{
              padding: tokens.spacing.md,
              marginBottom: tokens.spacing.lg,
              background: `${tokens.status.success}10`,
              border: `1px solid ${tokens.status.success}30`,
              borderRadius: tokens.radius.md,
              display: 'flex',
              alignItems: 'center',
              gap: tokens.spacing.sm,
            }}>
              <CheckCircleOutlined style={{ color: tokens.status.success }} />
              <span style={{ color: tokens.status.success }}>
                API key created successfully!
              </span>
            </div>
            <div style={{ marginBottom: tokens.spacing.md }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
              }}>
                Your API Key
              </label>
              <div style={{
                display: 'flex',
                gap: tokens.spacing.sm,
              }}>
                <Input
                  value={createdKey}
                  readOnly
                  style={{
                    background: tokens.bg.secondary,
                    borderColor: tokens.border.default,
                    fontFamily: 'monospace',
                  }}
                />
                <Button
                  icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
                  onClick={() => copyToClipboard(createdKey)}
                  style={{
                    color: copied ? tokens.status.success : tokens.text.secondary,
                  }}
                />
              </div>
            </div>
            <div style={{
              padding: tokens.spacing.md,
              background: `${tokens.status.warning}10`,
              border: `1px solid ${tokens.status.warning}30`,
              borderRadius: tokens.radius.md,
              fontSize: tokens.font.size.sm,
              color: tokens.status.warning,
            }}>
              ⚠️ Please save this API key now. You won't be able to see it again.
            </div>
          </div>
        ) : (
          <div>
            <label style={{
              display: 'block',
              marginBottom: tokens.spacing.sm,
              fontSize: tokens.font.size.sm,
              color: tokens.text.secondary,
            }}>
              API Key Name
            </label>
            <Input
              placeholder="e.g., My App, Development, Production"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onPressEnter={handleCreate}
              style={{
                background: tokens.bg.secondary,
                borderColor: tokens.border.default,
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
