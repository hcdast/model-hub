import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Tag, Skeleton, Empty } from 'antd';
import {
  PlusOutlined,
  ThunderboltOutlined,
  RightOutlined,
  ClockCircleOutlined,
  NodeIndexOutlined,
  RocketOutlined,
  PlayCircleOutlined,
  StarOutlined,
} from '@ant-design/icons';
import tokens from '../theme/dark';
import { workflowApi } from '../services/workflow-api';

interface Workflow {
  _id: string;
  name: string;
  description?: string;
  status: string;
  nodes: any[];
  createdAt: string;
  updatedAt: string;
}

// 模拟模板数据
const popularTemplates = [
  {
    id: '1',
    name: 'Text to Image Pipeline',
    description: 'Generate images from text prompts using multiple AI models',
    category: 'Image',
    nodes: 4,
    uses: 1250,
    rating: 4.8,
  },
  {
    id: '2',
    name: 'Video Enhancement',
    description: 'Upscale and enhance video quality with AI processing',
    category: 'Video',
    nodes: 6,
    uses: 890,
    rating: 4.6,
  },
  {
    id: '3',
    name: 'Content Summarizer',
    description: 'Extract key insights from long-form content',
    category: 'Text',
    nodes: 3,
    uses: 2100,
    rating: 4.9,
  },
  {
    id: '4',
    name: 'Image Style Transfer',
    description: 'Apply artistic styles to your images',
    category: 'Image',
    nodes: 5,
    uses: 1560,
    rating: 4.7,
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [recentWorkflows, setRecentWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentWorkflows();
  }, []);

  const fetchRecentWorkflows = async () => {
    try {
      const res: any = await workflowApi.list({ page: 1, pageSize: 4 });
      setRecentWorkflows(res.data?.items || []);
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: tokens.status.success,
      draft: tokens.text.tertiary,
      archived: tokens.text.disabled,
    };
    return colors[status] || tokens.text.tertiary;
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

  return (
    <div style={{
      minHeight: '100%',
      background: tokens.bg.primary,
    }}>
      {/* Hero 区域 */}
      <section style={{
        padding: `${tokens.spacing.xxl} ${tokens.spacing.xl}`,
        background: `linear-gradient(180deg, ${tokens.bg.secondary} 0%, ${tokens.bg.primary} 100%)`,
        borderBottom: `1px solid ${tokens.border.default}`,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          textAlign: 'center',
        }}>
          {/* 装饰性背景 */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 400,
            background: `radial-gradient(ellipse at center, ${tokens.accent.primary}15 0%, transparent 70%)`,
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* 图标 */}
            <div style={{
              width: 80,
              height: 80,
              margin: `0 auto ${tokens.spacing.xl}`,
              borderRadius: tokens.radius.xl,
              background: tokens.accent.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: tokens.shadow.glowLg,
            }}>
              <RocketOutlined style={{ fontSize: 36, color: '#fff' }} />
            </div>

            {/* 标题 */}
            <h1 style={{
              fontSize: tokens.font.size.hero,
              fontWeight: tokens.font.weight.bold,
              color: tokens.text.primary,
              marginBottom: tokens.spacing.md,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
            }}>
              Create Powerful{' '}
              <span className="gradient-text">AI Workflows</span>
            </h1>

            {/* 副标题 */}
            <p style={{
              fontSize: tokens.font.size.lg,
              color: tokens.text.secondary,
              marginBottom: tokens.spacing.xxl,
              maxWidth: 600,
              margin: `0 auto ${tokens.spacing.xxl}`,
              lineHeight: 1.6,
            }}>
              Design, build, and deploy automated AI pipelines with our visual canvas.
              Connect models, transform data, and orchestrate complex tasks.
            </p>

            {/* 按钮组 */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: tokens.spacing.md,
            }}>
              <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                onClick={() => navigate('/workflows/new')}
                style={{
                  height: 48,
                  padding: `0 ${tokens.spacing.xl}`,
                  fontSize: tokens.font.size.md,
                  fontWeight: tokens.font.weight.medium,
                  background: tokens.accent.gradient,
                  border: 'none',
                  borderRadius: tokens.radius.md,
                  boxShadow: tokens.shadow.glow,
                }}
              >
                Start from Scratch
              </Button>
              <Button
                size="large"
                icon={<ThunderboltOutlined />}
                onClick={() => navigate('/templates')}
                style={{
                  height: 48,
                  padding: `0 ${tokens.spacing.xl}`,
                  fontSize: tokens.font.size.md,
                  fontWeight: tokens.font.weight.medium,
                  background: tokens.bg.elevated,
                  borderColor: tokens.border.hover,
                  borderRadius: tokens.radius.md,
                  color: tokens.text.primary,
                }}
              >
                Browse Templates
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 内容区域 */}
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: `${tokens.spacing.xxl} ${tokens.spacing.xl}`,
      }}>
        {/* 最近工作流 */}
        <section style={{ marginBottom: tokens.spacing.xxl }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: tokens.spacing.lg,
          }}>
            <h2 style={{
              fontSize: tokens.font.size.xl,
              fontWeight: tokens.font.weight.semibold,
              color: tokens.text.primary,
            }}>
              Recent Workflows
            </h2>
            <Button
              type="link"
              icon={<RightOutlined />}
              onClick={() => navigate('/workflows')}
              style={{ color: tokens.accent.primary }}
            >
              View All
            </Button>
          </div>

          {loading ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: tokens.spacing.lg,
            }}>
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} style={{ background: tokens.bg.tertiary }}>
                  <Skeleton active paragraph={{ rows: 2 }} />
                </Card>
              ))}
            </div>
          ) : recentWorkflows.length === 0 ? (
            <Card style={{
              background: tokens.bg.tertiary,
              borderColor: tokens.border.default,
              textAlign: 'center',
              padding: tokens.spacing.xxl,
            }}>
              <Empty
                description={
                  <span style={{ color: tokens.text.secondary }}>
                    No workflows yet. Create your first workflow!
                  </span>
                }
              >
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/workflows/new')}
                >
                  Create Workflow
                </Button>
              </Empty>
            </Card>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: tokens.spacing.lg,
            }}>
              {/* 新建卡片 */}
              <Card
                hoverable
                onClick={() => navigate('/workflows/new')}
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                  borderRadius: tokens.radius.lg,
                  cursor: 'pointer',
                  minHeight: 180,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                bodyStyle={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: tokens.spacing.xl,
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
              </Card>

              {/* 工作流卡片 */}
              {recentWorkflows.map((workflow) => (
                <Card
                  key={workflow._id}
                  hoverable
                  onClick={() => navigate(`/workflows/${workflow._id}`)}
                  style={{
                    background: tokens.bg.tertiary,
                    borderColor: tokens.border.default,
                    borderRadius: tokens.radius.lg,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                  bodyStyle={{ padding: tokens.spacing.lg }}
                >
                  {/* 头部：名称 + 状态 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: tokens.spacing.md,
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
                    <Tag
                      color={getStatusColor(workflow.status)}
                      style={{
                        background: `${getStatusColor(workflow.status)}20`,
                        border: 'none',
                        marginLeft: tokens.spacing.sm,
                      }}
                    >
                      {workflow.status}
                    </Tag>
                  </div>

                  {/* 描述 */}
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

                  {/* 底部信息 */}
                  <div style={{
                    display: 'flex',
                    gap: tokens.spacing.lg,
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
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* 热门模板 */}
        <section>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: tokens.spacing.lg,
          }}>
            <h2 style={{
              fontSize: tokens.font.size.xl,
              fontWeight: tokens.font.weight.semibold,
              color: tokens.text.primary,
            }}>
              Popular Templates
            </h2>
            <Button
              type="link"
              icon={<RightOutlined />}
              onClick={() => navigate('/templates')}
              style={{ color: tokens.accent.primary }}
            >
              Browse All
            </Button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: tokens.spacing.lg,
          }}>
            {popularTemplates.map((template) => (
              <Card
                key={template.id}
                hoverable
                onClick={() => navigate(`/templates/${template.id}`)}
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                  borderRadius: tokens.radius.lg,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                }}
                bodyStyle={{ padding: tokens.spacing.lg }}
              >
                {/* 模板预览图占位 */}
                <div style={{
                  height: 120,
                  marginBottom: tokens.spacing.md,
                  borderRadius: tokens.radius.md,
                  background: `linear-gradient(135deg, ${tokens.accent.primary}30 0%, ${tokens.accent.secondary}20 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <PlayCircleOutlined style={{
                    fontSize: 36,
                    color: tokens.accent.primary,
                    opacity: 0.6,
                  }} />
                </div>

                {/* 模板信息 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: tokens.spacing.sm,
                }}>
                  <h3 style={{
                    fontSize: tokens.font.size.base,
                    fontWeight: tokens.font.weight.medium,
                    color: tokens.text.primary,
                    margin: 0,
                    flex: 1,
                  }}>
                    {template.name}
                  </h3>
                  <Tag
                    style={{
                      background: `${tokens.accent.primary}20`,
                      color: tokens.accent.primary,
                      border: 'none',
                    }}
                  >
                    {template.category}
                  </Tag>
                </div>

                <p style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.secondary,
                  marginBottom: tokens.spacing.md,
                  lineHeight: 1.5,
                }}>
                  {template.description}
                </p>

                {/* 统计信息 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: tokens.text.tertiary,
                  fontSize: tokens.font.size.sm,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                    <NodeIndexOutlined />
                    {template.nodes} nodes
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                    <StarOutlined />
                    {template.rating}
                  </span>
                  <span>
                    {template.uses.toLocaleString()} uses
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
