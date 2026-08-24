import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Tag, Tabs, Empty, Avatar } from 'antd';
import {
  SearchOutlined,
  PlayCircleOutlined,
  StarOutlined,
  NodeIndexOutlined,
  ThunderboltOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  FileTextOutlined,
  RocketOutlined,
  UserOutlined,
  EyeOutlined,
  CopyOutlined,
  HeartOutlined,
  FireOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import tokens from '../theme/dark';

interface CommunityTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: number;
  uses: number;
  rating: number;
  likes: number;
  views: number;
  author: string;
  authorAvatar?: string;
  createdAt: string;
  tags: string[];
  thumbnail?: string;
  featured?: boolean;
}

// 模拟社区模板数据
const communityTemplates: CommunityTemplate[] = [
  {
    id: '1',
    name: 'AI 演员试镜工作流',
    description: '创建 AI 演员并生成多情绪试镜视频，支持角色合规验证',
    category: 'Video',
    nodes: 8,
    uses: 15600,
    rating: 4.9,
    likes: 2340,
    views: 45200,
    author: 'TapNow Studio',
    createdAt: '2024-01-15',
    tags: ['演员', '试镜', '情绪', '角色'],
    featured: true,
  },
  {
    id: '2',
    name: '电商产品视频生成',
    description: '一键生成产品展示视频，支持多角度和背景替换',
    category: 'Video',
    nodes: 6,
    uses: 28900,
    rating: 4.8,
    likes: 3560,
    views: 78500,
    author: 'Ecommerce AI',
    createdAt: '2024-01-10',
    tags: ['电商', '产品', '视频', '背景替换'],
    featured: true,
  },
  {
    id: '3',
    name: '广告创意一键生成',
    description: '输入产品描述，自动生成完整广告脚本和分镜',
    category: 'Creative',
    nodes: 5,
    uses: 12800,
    rating: 4.7,
    likes: 1890,
    views: 32100,
    author: 'Creative AI Lab',
    createdAt: '2024-01-08',
    tags: ['广告', '创意', '脚本', '分镜'],
  },
  {
    id: '4',
    name: 'AI 换脸舞蹈视频',
    description: '将你的脸替换到舞蹈视频中，效果自然逼真',
    category: 'Video',
    nodes: 4,
    uses: 45200,
    rating: 4.9,
    likes: 5670,
    views: 125000,
    author: 'FaceSwap Pro',
    createdAt: '2024-01-05',
    tags: ['换脸', '舞蹈', '娱乐'],
    featured: true,
  },
  {
    id: '5',
    name: '音乐 MV 自动生成',
    description: '上传音乐，自动生成匹配节奏的 MV 视频',
    category: 'Video',
    nodes: 7,
    uses: 8900,
    rating: 4.6,
    likes: 1230,
    views: 23400,
    author: 'Music Video AI',
    createdAt: '2024-01-03',
    tags: ['音乐', 'MV', '视频', '节奏'],
  },
  {
    id: '6',
    name: 'AI 时尚海报设计',
    description: '生成专业级时尚海报，支持多种风格和布局',
    category: 'Image',
    nodes: 4,
    uses: 19800,
    rating: 4.8,
    likes: 2890,
    views: 56700,
    author: 'Design Studio',
    createdAt: '2024-01-01',
    tags: ['海报', '时尚', '设计', '风格'],
  },
  {
    id: '7',
    name: '短视频批量生成',
    description: '批量生成抖音/快手风格短视频，支持模板定制',
    category: 'Video',
    nodes: 5,
    uses: 34500,
    rating: 4.7,
    likes: 4120,
    views: 89200,
    author: 'Short Video AI',
    createdAt: '2023-12-28',
    tags: ['短视频', '批量', '抖音', '快手'],
  },
  {
    id: '8',
    name: 'AI 配音合成',
    description: '为视频添加专业配音，支持多种音色和语言',
    category: 'Audio',
    nodes: 3,
    uses: 15600,
    rating: 4.6,
    likes: 1890,
    views: 34500,
    author: 'Voice AI',
    createdAt: '2023-12-25',
    tags: ['配音', '语音', 'TTS', '多语言'],
  },
  {
    id: '9',
    name: '产品图片背景替换',
    description: '一键替换产品图片背景，支持自定义场景',
    category: 'Image',
    nodes: 3,
    uses: 52300,
    rating: 4.9,
    likes: 6780,
    views: 145000,
    author: 'Product Photo AI',
    createdAt: '2023-12-20',
    tags: ['产品', '背景', '替换', '电商'],
    featured: true,
  },
  {
    id: '10',
    name: 'AI 角色一致性生成',
    description: '生成保持角色一致性的多场景图片和视频',
    category: 'Image',
    nodes: 6,
    uses: 11200,
    rating: 4.7,
    likes: 1560,
    views: 28900,
    author: 'Character AI',
    createdAt: '2023-12-18',
    tags: ['角色', '一致性', '多场景'],
  },
  {
    id: '11',
    name: '歌词可视化视频',
    description: '将歌词转化为视觉艺术视频，节奏同步',
    category: 'Video',
    nodes: 5,
    uses: 7800,
    rating: 4.5,
    likes: 1120,
    views: 19800,
    author: 'Lyric Video AI',
    createdAt: '2023-12-15',
    tags: ['歌词', '可视化', '音乐', '艺术'],
  },
  {
    id: '12',
    name: '绿幕抠像合成',
    description: '专业级绿幕抠像，支持复杂边缘处理',
    category: 'Video',
    nodes: 4,
    uses: 9800,
    rating: 4.6,
    likes: 1340,
    views: 25600,
    author: 'Green Screen AI',
    createdAt: '2023-12-10',
    tags: ['绿幕', '抠像', '合成', '特效'],
  },
];

const categories = [
  { key: 'all', label: 'All', icon: <RocketOutlined /> },
  { key: 'featured', label: 'Featured', icon: <FireOutlined /> },
  { key: 'Image', label: 'Image', icon: <PictureOutlined /> },
  { key: 'Video', label: 'Video', icon: <VideoCameraOutlined /> },
  { key: 'Audio', label: 'Audio', icon: <AudioOutlined /> },
  { key: 'Creative', label: 'Creative', icon: <FileTextOutlined /> },
];

export default function Community() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortBy, setSortBy] = useState<'popular' | 'newest' | 'rating'>('popular');

  const filteredTemplates = communityTemplates
    .filter((template) => {
      const matchesSearch =
        template.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        template.description.toLowerCase().includes(searchValue.toLowerCase()) ||
        template.tags.some(tag => tag.toLowerCase().includes(searchValue.toLowerCase()));
      const matchesCategory =
        activeCategory === 'all' ||
        (activeCategory === 'featured' && template.featured) ||
        template.category === activeCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      if (sortBy === 'popular') return b.uses - a.uses;
      if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return b.rating - a.rating;
    });

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Image: '#f59e0b',
      Video: '#3b82f6',
      Audio: '#8b5cf6',
      Creative: '#22c55e',
    };
    return colors[category] || tokens.accent.primary;
  };

  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return `${(num / 10000).toFixed(1)}w`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  };

  return (
    <div style={{
      padding: tokens.spacing.xl,
      maxWidth: 1400,
      margin: '0 auto',
    }}>
      {/* 页面头部 */}
      <div style={{
        marginBottom: tokens.spacing.xl,
      }}>
        <h1 style={{
          fontSize: tokens.font.size.xxl,
          fontWeight: tokens.font.weight.semibold,
          color: tokens.text.primary,
          marginBottom: tokens.spacing.sm,
        }}>
          Community Templates
        </h1>
        <p style={{
          fontSize: tokens.font.size.md,
          color: tokens.text.secondary,
        }}>
          Discover and clone workflows shared by the community
        </p>
      </div>

      {/* 搜索和筛选 */}
      <div style={{
        display: 'flex',
        gap: tokens.spacing.md,
        marginBottom: tokens.spacing.xl,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <Input
          prefix={<SearchOutlined style={{ color: tokens.text.tertiary }} />}
          placeholder="Search templates..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          style={{
            width: 400,
            background: tokens.bg.tertiary,
            borderColor: tokens.border.default,
          }}
        />
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex',
          gap: tokens.spacing.xs,
        }}>
          {[
            { key: 'popular', label: 'Popular', icon: <FireOutlined /> },
            { key: 'newest', label: 'Newest', icon: <ClockCircleOutlined /> },
            { key: 'rating', label: 'Top Rated', icon: <StarOutlined /> },
          ].map(item => (
            <Button
              key={item.key}
              icon={item.icon}
              onClick={() => setSortBy(item.key as any)}
              style={{
                background: sortBy === item.key ? tokens.accent.primary : tokens.bg.tertiary,
                borderColor: sortBy === item.key ? tokens.accent.primary : tokens.border.default,
                color: sortBy === item.key ? '#fff' : tokens.text.secondary,
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 分类标签页 */}
      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={categories.map((cat) => ({
          key: cat.key,
          label: (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.spacing.sm,
            }}>
              {cat.icon}
              {cat.label}
            </span>
          ),
        }))}
        style={{ marginBottom: tokens.spacing.xl }}
      />

      {/* 模板网格 */}
      {filteredTemplates.length === 0 ? (
        <div style={{
          background: tokens.bg.tertiary,
          borderRadius: tokens.radius.lg,
          padding: tokens.spacing.xxl,
          textAlign: 'center',
        }}>
          <Empty
            description={
              <span style={{ color: tokens.text.secondary }}>
                No templates found matching your criteria
              </span>
            }
          />
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: tokens.spacing.lg,
        }}>
          {filteredTemplates.map((template) => {
            const categoryColor = getCategoryColor(template.category);
            return (
              <div
                key={template.id}
                style={{
                  background: tokens.bg.tertiary,
                  border: `1px solid ${tokens.border.default}`,
                  borderRadius: tokens.radius.lg,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                }}
                onClick={() => navigate(`/templates/${template.id}`)}
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
                {/* 预览图 */}
                <div style={{
                  height: 180,
                  background: `linear-gradient(135deg, ${categoryColor}20 0%, ${categoryColor}10 100%)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}>
                  <PlayCircleOutlined style={{
                    fontSize: 48,
                    color: categoryColor,
                    opacity: 0.4,
                  }} />

                  {/* 分类标签 */}
                  <Tag
                    color={categoryColor}
                    style={{
                      position: 'absolute',
                      top: tokens.spacing.md,
                      left: tokens.spacing.md,
                      background: `${categoryColor}20`,
                      border: 'none',
                      margin: 0,
                    }}
                  >
                    {template.category}
                  </Tag>

                  {/* 精选标签 */}
                  {template.featured && (
                    <Tag
                      color="gold"
                      style={{
                        position: 'absolute',
                        top: tokens.spacing.md,
                        right: tokens.spacing.md,
                        background: 'rgba(250, 173, 20, 0.2)',
                        border: 'none',
                        margin: 0,
                      }}
                    >
                      <FireOutlined /> Featured
                    </Tag>
                  )}

                  {/* 统计信息 */}
                  <div style={{
                    position: 'absolute',
                    bottom: tokens.spacing.md,
                    right: tokens.spacing.md,
                    display: 'flex',
                    gap: tokens.spacing.sm,
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.spacing.xs,
                      background: `${tokens.bg.primary}cc`,
                      padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
                      borderRadius: tokens.radius.sm,
                    }}>
                      <EyeOutlined style={{ fontSize: 12 }} />
                      <span style={{ fontSize: tokens.font.size.xs }}>
                        {formatNumber(template.views)}
                      </span>
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.spacing.xs,
                      background: `${tokens.bg.primary}cc`,
                      padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
                      borderRadius: tokens.radius.sm,
                    }}>
                      <HeartOutlined style={{ fontSize: 12, color: '#ef4444' }} />
                      <span style={{ fontSize: tokens.font.size.xs }}>
                        {formatNumber(template.likes)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 内容区 */}
                <div style={{ padding: tokens.spacing.lg }}>
                  <h3 style={{
                    fontSize: tokens.font.size.md,
                    fontWeight: tokens.font.weight.semibold,
                    color: tokens.text.primary,
                    margin: 0,
                    marginBottom: tokens.spacing.sm,
                  }}>
                    {template.name}
                  </h3>

                  <p style={{
                    fontSize: tokens.font.size.sm,
                    color: tokens.text.secondary,
                    marginBottom: tokens.spacing.md,
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {template.description}
                  </p>

                  {/* 标签 */}
                  <div style={{
                    display: 'flex',
                    gap: tokens.spacing.xs,
                    marginBottom: tokens.spacing.md,
                    flexWrap: 'wrap',
                  }}>
                    {template.tags.slice(0, 3).map((tag) => (
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
                  </div>

                  {/* 作者信息 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.spacing.sm,
                    marginBottom: tokens.spacing.md,
                  }}>
                    <Avatar
                      size={24}
                      icon={<UserOutlined />}
                      src={template.authorAvatar}
                      style={{ background: tokens.accent.primary }}
                    />
                    <span style={{
                      fontSize: tokens.font.size.sm,
                      color: tokens.text.secondary,
                    }}>
                      {template.author}
                    </span>
                  </div>

                  {/* 底部统计 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: tokens.spacing.md,
                    borderTop: `1px solid ${tokens.border.default}`,
                  }}>
                    <div style={{
                      display: 'flex',
                      gap: tokens.spacing.lg,
                      color: tokens.text.tertiary,
                      fontSize: tokens.font.size.sm,
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                        <NodeIndexOutlined />
                        {template.nodes} nodes
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                        <StarOutlined style={{ color: '#f59e0b' }} />
                        {template.rating}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.xs }}>
                        <ThunderboltOutlined />
                        {formatNumber(template.uses)}
                      </span>
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workflows/new?template=${template.id}`);
                      }}
                      style={{
                        background: tokens.accent.gradient,
                        border: 'none',
                      }}
                    >
                      Clone
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
