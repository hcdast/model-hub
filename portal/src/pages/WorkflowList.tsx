import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Tag, Select, Empty, Spin, message, Dropdown } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  CopyOutlined,
  NodeIndexOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import tokens from '../theme/dark';
import { workflowApi } from '../services/workflow-api';

interface Workflow {
  _id: string;
  name: string;
  description?: string;
  status: string;
  nodes: any[];
  edges: any[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export default function WorkflowList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (searchValue) params.search = searchValue;
      if (statusFilter !== 'all') params.status = statusFilter;

      const res: any = await workflowApi.list(params);
      setItems(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      message.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]);

  const handleDelete = async (id: string) => {
    try {
      await workflowApi.delete(id);
      message.success('Workflow deleted');
      fetchData();
    } catch (err) {
      message.error('Failed to delete workflow');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const res: any = await workflowApi.get(id);
      const workflow = res.data;
      await workflowApi.create({
        name: `${workflow.name} (Copy)`,
        description: workflow.description,
        nodes: workflow.nodes,
        edges: workflow.edges,
      });
      message.success('Workflow duplicated');
      fetchData();
    } catch (err) {
      message.error('Failed to duplicate workflow');
    }
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; label: string }> = {
      active: { color: tokens.status.success, label: 'Active' },
      draft: { color: tokens.text.tertiary, label: 'Draft' },
      archived: { color: tokens.text.disabled, label: 'Archived' },
    };
    return configs[status] || { color: tokens.text.tertiary, label: status };
  };

  const formatDate = (date: string) => {
    if (!date) return '-';
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString();
  };

  const getActionItems = (workflow: Workflow) => [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: 'Edit',
      onClick: () => navigate(`/workflows/${workflow._id}`),
    },
    {
      key: 'duplicate',
      icon: <CopyOutlined />,
      label: 'Duplicate',
      onClick: () => handleDuplicate(workflow._id),
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: 'Delete',
      danger: true,
      onClick: () => handleDelete(workflow._id),
    },
  ];

  const renderGridView = () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: tokens.spacing.lg,
    }}>
      {/* 新建卡片 */}
      <div
        onClick={() => navigate('/workflows/new')}
        style={{
          background: tokens.bg.tertiary,
          border: `1px dashed ${tokens.border.hover}`,
          borderRadius: tokens.radius.lg,
          padding: tokens.spacing.xl,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = tokens.accent.primary;
          e.currentTarget.style.background = `${tokens.accent.primary}10`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = tokens.border.hover;
          e.currentTarget.style.background = tokens.bg.tertiary;
        }}
      >
        <div style={{
          width: 48,
          height: 48,
          borderRadius: tokens.radius.md,
          background: `${tokens.accent.primary}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: tokens.spacing.md,
        }}>
          <PlusOutlined style={{ fontSize: 24, color: tokens.accent.primary }} />
        </div>
        <span style={{
          fontSize: tokens.font.size.base,
          color: tokens.text.secondary,
        }}>
          Create New Workflow
        </span>
      </div>

      {/* 工作流卡片 */}
      {items.map((workflow) => {
        const statusConfig = getStatusConfig(workflow.status);
        return (
          <div
            key={workflow._id}
            style={{
              background: tokens.bg.tertiary,
              border: `1px solid ${tokens.border.default}`,
              borderRadius: tokens.radius.lg,
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
            onClick={() => navigate(`/workflows/${workflow._id}`)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = tokens.shadow.lg;
              e.currentTarget.style.borderColor = tokens.border.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = tokens.border.default;
            }}
          >
            {/* 预览图占位 */}
            <div style={{
              height: 120,
              background: `linear-gradient(135deg, ${tokens.bg.elevated} 0%, ${tokens.bg.hover} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              <NodeIndexOutlined style={{
                fontSize: 32,
                color: tokens.text.tertiary,
                opacity: 0.3,
              }} />
              {/* 状态标签 */}
              <Tag
                color={statusConfig.color}
                style={{
                  position: 'absolute',
                  top: tokens.spacing.sm,
                  right: tokens.spacing.sm,
                  background: `${statusConfig.color}20`,
                  border: 'none',
                  margin: 0,
                }}
              >
                {statusConfig.label}
              </Tag>
            </div>

            {/* 内容区 */}
            <div style={{ padding: tokens.spacing.lg }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: tokens.spacing.sm,
              }}>
                <h3 style={{
                  fontSize: tokens.font.size.md,
                  fontWeight: tokens.font.weight.medium,
                  color: tokens.text.primary,
                  margin: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {workflow.name}
                </h3>
                <Dropdown
                  menu={{ items: getActionItems(workflow) }}
                  trigger={['click']}
                  placement="bottomRight"
                >
                  <Button
                    type="text"
                    icon={<MoreOutlined />}
                    size="small"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: tokens.text.tertiary }}
                  />
                </Dropdown>
              </div>

              {workflow.description && (
                <p style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.secondary,
                  marginBottom: tokens.spacing.md,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {workflow.description}
                </p>
              )}

              {/* 标签 */}
              {workflow.tags && workflow.tags.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: tokens.spacing.xs,
                  marginBottom: tokens.spacing.md,
                  flexWrap: 'wrap',
                }}>
                  {workflow.tags.slice(0, 3).map((tag) => (
                    <Tag
                      key={tag}
                      style={{
                        background: `${tokens.accent.primary}15`,
                        color: tokens.accent.primary,
                        border: 'none',
                        fontSize: tokens.font.size.xs,
                      }}
                    >
                      {tag}
                    </Tag>
                  ))}
                  {workflow.tags.length > 3 && (
                    <Tag style={{
                      background: tokens.bg.elevated,
                      border: 'none',
                      fontSize: tokens.font.size.xs,
                    }}>
                      +{workflow.tags.length - 3}
                    </Tag>
                  )}
                </div>
              )}

              {/* 底部信息 */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                color: tokens.text.tertiary,
                fontSize: tokens.font.size.sm,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                  <NodeIndexOutlined />
                  {workflow.nodes?.length || 0} nodes
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                  <ClockCircleOutlined />
                  {formatDate(workflow.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderListView = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.spacing.sm,
    }}>
      {/* 新建按钮 */}
      <div
        onClick={() => navigate('/workflows/new')}
        style={{
          background: tokens.bg.tertiary,
          border: `1px dashed ${tokens.border.hover}`,
          borderRadius: tokens.radius.md,
          padding: `${tokens.spacing.md} ${tokens.spacing.lg}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: tokens.spacing.md,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = tokens.accent.primary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = tokens.border.hover;
        }}
      >
        <PlusOutlined style={{ color: tokens.accent.primary }} />
        <span style={{ color: tokens.text.secondary }}>Create New Workflow</span>
      </div>

      {/* 工作流列表 */}
      {items.map((workflow) => {
        const statusConfig = getStatusConfig(workflow.status);
        return (
          <div
            key={workflow._id}
            style={{
              background: tokens.bg.tertiary,
              border: `1px solid ${tokens.border.default}`,
              borderRadius: tokens.radius.md,
              padding: `${tokens.spacing.md} ${tokens.spacing.lg}`,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: tokens.spacing.lg,
            }}
            onClick={() => navigate(`/workflows/${workflow._id}`)}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = tokens.border.hover;
              e.currentTarget.style.background = tokens.bg.elevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = tokens.border.default;
              e.currentTarget.style.background = tokens.bg.tertiary;
            }}
          >
            {/* 图标 */}
            <div style={{
              width: 40,
              height: 40,
              borderRadius: tokens.radius.md,
              background: `${tokens.accent.primary}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <NodeIndexOutlined style={{ color: tokens.accent.primary }} />
            </div>

            {/* 信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacing.sm,
                marginBottom: tokens.spacing.xs,
              }}>
                <span style={{
                  fontSize: tokens.font.size.base,
                  fontWeight: tokens.font.weight.medium,
                  color: tokens.text.primary,
                }}>
                  {workflow.name}
                </span>
                <Tag
                  color={statusConfig.color}
                  style={{
                    background: `${statusConfig.color}20`,
                    border: 'none',
                    fontSize: tokens.font.size.xs,
                  }}
                >
                  {statusConfig.label}
                </Tag>
              </div>
              {workflow.description && (
                <p style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.tertiary,
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {workflow.description}
                </p>
              )}
            </div>

            {/* 统计 */}
            <div style={{
              display: 'flex',
              gap: tokens.spacing.xl,
              color: tokens.text.tertiary,
              fontSize: tokens.font.size.sm,
              flexShrink: 0,
            }}>
              <span>{workflow.nodes?.length || 0} nodes</span>
              <span>{formatDate(workflow.updatedAt)}</span>
            </div>

            {/* 操作 */}
            <Dropdown
              menu={{ items: getActionItems(workflow) }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button
                type="text"
                icon={<MoreOutlined />}
                onClick={(e) => e.stopPropagation()}
                style={{ color: tokens.text.tertiary }}
              />
            </Dropdown>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{
      padding: tokens.spacing.xl,
      maxWidth: 1400,
      margin: '0 auto',
    }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: tokens.spacing.xl,
      }}>
        <h1 style={{
          fontSize: tokens.font.size.xxl,
          fontWeight: tokens.font.weight.semibold,
          color: tokens.text.primary,
          margin: 0,
        }}>
          Workflows
        </h1>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/workflows/new')}
          style={{
            background: tokens.accent.gradient,
            border: 'none',
          }}
        >
          Create Workflow
        </Button>
      </div>

      {/* 筛选栏 */}
      <div style={{
        display: 'flex',
        gap: tokens.spacing.md,
        marginBottom: tokens.spacing.xl,
        flexWrap: 'wrap',
      }}>
        <Input
          prefix={<SearchOutlined style={{ color: tokens.text.tertiary }} />}
          placeholder="Search workflows..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          style={{
            width: 300,
            background: tokens.bg.tertiary,
            borderColor: tokens.border.default,
          }}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 150 }}
          options={[
            { value: 'all', label: 'All Status' },
            { value: 'active', label: 'Active' },
            { value: 'draft', label: 'Draft' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex',
          gap: tokens.spacing.xs,
          background: tokens.bg.tertiary,
          borderRadius: tokens.radius.md,
          padding: tokens.spacing.xs,
        }}>
          <Button
            type={viewMode === 'grid' ? 'primary' : 'text'}
            icon={<AppstoreOutlined />}
            onClick={() => setViewMode('grid')}
            style={{
              background: viewMode === 'grid' ? tokens.accent.primary : 'transparent',
            }}
          />
          <Button
            type={viewMode === 'list' ? 'primary' : 'text'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('list')}
            style={{
              background: viewMode === 'list' ? tokens.accent.primary : 'transparent',
            }}
          />
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={fetchData}
        >
          Refresh
        </Button>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400,
        }}>
          <Spin size="large" />
        </div>
      ) : items.length === 0 ? (
        <div style={{
          background: tokens.bg.tertiary,
          borderRadius: tokens.radius.lg,
          padding: tokens.spacing.xxl,
          textAlign: 'center',
        }}>
          <Empty
            description={
              <span style={{ color: tokens.text.secondary }}>
                {searchValue ? 'No workflows found matching your search' : 'No workflows yet'}
              </span>
            }
          >
            {!searchValue && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/workflows/new')}
              >
                Create Your First Workflow
              </Button>
            )}
          </Empty>
        </div>
      ) : viewMode === 'grid' ? (
        renderGridView()
      ) : (
        renderListView()
      )}

      {/* 分页 */}
      {total > pageSize && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: tokens.spacing.xl,
        }}>
          <div style={{
            display: 'flex',
            gap: tokens.spacing.sm,
          }}>
            {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                type={p === page ? 'primary' : 'default'}
                onClick={() => setPage(p)}
                style={{
                  minWidth: 36,
                  background: p === page ? tokens.accent.primary : tokens.bg.tertiary,
                }}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
