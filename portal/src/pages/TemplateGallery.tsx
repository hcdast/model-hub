import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Tag, Tabs, Empty } from 'antd';
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
} from '@ant-design/icons';
import tokens from '../theme/dark';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: number;
  uses: number;
  rating: number;
  thumbnail?: string;
  tags: string[];
}

// 模拟模板数据
const templates: Template[] = [
  {
    id: '1',
    name: 'Text to Image Pipeline',
    description: 'Generate stunning images from text prompts using multiple AI models with automatic refinement',
    category: 'Image',
    nodes: 4,
    uses: 12500,
    rating: 4.8,
    tags: ['text-to-image', 'stable-diffusion', 'midjourney'],
  },
  {
    id: '2',
    name: 'Video Enhancement Suite',
    description: 'Upscale, denoise, and enhance video quality with AI-powered processing pipeline',
    category: 'Video',
    nodes: 6,
    uses: 8900,
    rating: 4.6,
    tags: ['video', 'upscaling', 'enhancement'],
  },
  {
    id: '3',
    name: 'Content Summarizer',
    description: 'Extract key insights and generate summaries from long-form content automatically',
    category: 'Text',
    nodes: 3,
    uses: 21000,
    rating: 4.9,
    tags: ['summarization', 'nlp', 'content'],
  },
  {
    id: '4',
    name: 'Image Style Transfer',
    description: 'Apply artistic styles from reference images to your photos with one click',
    category: 'Image',
    nodes: 5,
    uses: 15600,
    rating: 4.7,
    tags: ['style-transfer', 'artistic', 'creative'],
  },
  {
    id: '5',
    name: 'Audio Transcription & Analysis',
    description: 'Convert speech to text with speaker diarization and sentiment analysis',
    category: 'Audio',
    nodes: 4,
    uses: 9800,
    rating: 4.5,
    tags: ['transcription', 'speech-to-text', 'analysis'],
  },
  {
    id: '6',
    name: 'Product Photo Generator',
    description: 'Create professional product photos with AI backgrounds and lighting',
    category: 'Image',
    nodes: 5,
    uses: 18200,
    rating: 4.8,
    tags: ['product', 'ecommerce', 'photography'],
  },
  {
    id: '7',
    name: 'Video Subtitle Generator',
    description: 'Auto-generate subtitles with translation support for 50+ languages',
    category: 'Video',
    nodes: 4,
    uses: 11200,
    rating: 4.6,
    tags: ['subtitles', 'translation', 'multilingual'],
  },
  {
    id: '8',
    name: 'Blog Post Generator',
    description: 'Generate complete blog posts with images, SEO optimization, and social media snippets',
    category: 'Text',
    nodes: 7,
    uses: 14500,
    rating: 4.7,
    tags: ['blog', 'content', 'seo'],
  },
  {
    id: '9',
    name: 'Music Generation Pipeline',
    description: 'Create original music tracks with customizable style, tempo, and instruments',
    category: 'Audio',
    nodes: 3,
    uses: 6700,
    rating: 4.4,
    tags: ['music', 'generation', 'creative'],
  },
  {
    id: '10',
    name: 'Face Swap Video Creator',
    description: 'Seamlessly swap faces in videos with high-quality AI processing',
    category: 'Video',
    nodes: 5,
    uses: 22300,
    rating: 4.9,
    tags: ['face-swap', 'video', 'creative'],
  },
  {
    id: '11',
    name: 'Document Q&A System',
    description: 'Build intelligent Q&A systems from your documents with RAG pipeline',
    category: 'Text',
    nodes: 6,
    uses: 16800,
    rating: 4.8,
    tags: ['qa', 'rag', 'documents'],
  },
  {
    id: '12',
    name: 'Image Background Remover',
    description: 'Remove and replace image backgrounds with AI precision in seconds',
    category: 'Image',
    nodes: 3,
    uses: 31200,
    rating: 4.9,
    tags: ['background-removal', 'editing', 'quick'],
  },
];

const categories = [
  { key: 'all', label: 'All Templates', icon: <RocketOutlined /> },
  { key: 'Image', label: 'Image', icon: <PictureOutlined /> },
  { key: 'Video', label: 'Video', icon: <VideoCameraOutlined /> },
  { key: 'Audio', label: 'Audio', icon: <AudioOutlined /> },
  { key: 'Text', label: 'Text', icon: <FileTextOutlined /> },
];

export default function TemplateGallery() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      template.description.toLowerCase().includes(searchValue.toLowerCase()) ||
      template.tags.some(tag => tag.toLowerCase().includes(searchValue.toLowerCase()));
    const matchesCategory = activeCategory === 'all' || template.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Image: '#f59e0b',
      Video: '#3b82f6',
      Audio: '#8b5cf6',
      Text: '#22c55e',
    };
    return colors[category] || tokens.accent.primary;
  };

  const formatNumber = (num: number) => {
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
          margin: 0,
          marginBottom: tokens.spacing.sm,
        }}>
          Template Gallery
        </h1>
        <p style={{
          fontSize: tokens.font.size.md,
          color: tokens.text.secondary,
          margin: 0,
        }}>
          Start with pre-built workflows and customize them to your needs
        </p>
      </div>

      {/* 搜索和筛选 */}
      <div style={{
        display: 'flex',
        gap: tokens.spacing.md,
        marginBottom: tokens.spacing.xl,
        flexWrap: 'wrap',
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
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
                  height: 160,
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
                  {/* 评分 */}
                  <div style={{
                    position: 'absolute',
                    top: tokens.spacing.md,
                    right: tokens.spacing.md,
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.spacing.xs,
                    background: `${tokens.bg.primary}cc`,
                    padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`,
                    borderRadius: tokens.radius.sm,
                  }}>
                    <StarOutlined style={{ color: '#f59e0b', fontSize: 12 }} />
                    <span style={{
                      color: tokens.text.primary,
                      fontSize: tokens.font.size.sm,
                      fontWeight: tokens.font.weight.medium,
                    }}>
                      {template.rating}
                    </span>
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
                        <ThunderboltOutlined />
                        {formatNumber(template.uses)} uses
                      </span>
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/workflows/new?template=${template.id}`);
                      }}
                      style={{
                        background: tokens.accent.gradient,
                        border: 'none',
                      }}
                    >
                      Use Template
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
