import { Input, Select, Button, Space, Divider, InputNumber, Slider } from 'antd';
import { DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Node } from 'reactflow';
import tokens from '../../theme/dark';
import { WorkflowNodeData } from '../../store/workflow-store';
import { getNodeDefinition } from '../../types/node-types';
import { nodeTypeSupportsModel } from '../../utils/model-type-map';
import ModelSelect from './ModelSelect';

interface Props {
  nodeId: string;
  node?: Node<WorkflowNodeData>;
  onUpdate: (data: Partial<WorkflowNodeData>) => void;
  onDelete: () => void;
  onRun?: () => void;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: tokens.font.size.sm,
  color: tokens.text.secondary,
  fontWeight: tokens.font.weight.medium,
};

export default function NodeDetailPanel({ node, onUpdate, onDelete, onRun }: Props) {
  if (!node) {
    return null;
  }

  const { data } = node;
  const nodeDef = getNodeDefinition(data.type);

  // 通用参数更新
  const updateParams = (key: string, value: any) => {
    onUpdate({
      parameters: {
        ...data.parameters,
        [key]: value,
      },
    });
  };

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 节点类型信息 */}
        {nodeDef && (
          <div style={{
            padding: tokens.spacing.md,
            background: `${nodeDef.color}10`,
            borderRadius: tokens.radius.md,
            border: `1px solid ${nodeDef.color}30`,
          }}>
            <div style={{
              fontSize: tokens.font.size.sm,
              fontWeight: tokens.font.weight.medium,
              color: nodeDef.color,
              marginBottom: tokens.spacing.xs,
            }}>
              {nodeDef.label}
            </div>
            <div style={{
              fontSize: tokens.font.size.xs,
              color: tokens.text.tertiary,
            }}>
              {nodeDef.description}
            </div>
          </div>
        )}

        {/* 基本信息 */}
        <div>
          <label style={labelStyle}>Node Label</label>
          <Input
            value={data.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="Enter node label"
            style={{
              background: tokens.bg.tertiary,
              borderColor: tokens.border.default,
            }}
          />
        </div>

        {/* 模型节点配置（兼容旧数据） */}
        {(data as any).type === 'model' && (
          <div>
            <label style={labelStyle}>Model ID</label>
            <Input
              value={data.modelId}
              onChange={(e) => onUpdate({ modelId: e.target.value })}
              placeholder="Enter model ID"
              style={{
                background: tokens.bg.tertiary,
                borderColor: tokens.border.default,
              }}
            />
          </div>
        )}

        {/* ========== 新增节点类型配置 ========== */}

        {/* 文生图/图生图/图片编辑/图片超分 */}
        {(data.type === 'text-to-image' || data.type === 'image-to-image' ||
          data.type === 'image-editor' || data.type === 'image-upscale' ||
          data.type === 'character-create' || data.type === 'face-swap' ||
          data.type === 'character-swap') && (
          <>
            <div>
              <label style={labelStyle}>模型</label>
              <ModelSelect
                nodeType={data.type}
                value={data.modelId}
                onChange={(value) => onUpdate({ modelId: value })}
              />
            </div>

            {(data.type === 'text-to-image' || data.type === 'character-create') && (
              <>
                <div>
                  <label style={labelStyle}>Prompt</label>
                  <Input.TextArea
                    value={data.parameters?.prompt || ''}
                    onChange={(e) => updateParams('prompt', e.target.value)}
                    placeholder="Describe the image you want to generate..."
                    rows={4}
                    style={{
                      background: tokens.bg.tertiary,
                      borderColor: tokens.border.default,
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Negative Prompt</label>
                  <Input.TextArea
                    value={data.parameters?.negativePrompt || ''}
                    onChange={(e) => updateParams('negativePrompt', e.target.value)}
                    placeholder="What to exclude..."
                    rows={2}
                    style={{
                      background: tokens.bg.tertiary,
                      borderColor: tokens.border.default,
                    }}
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: tokens.spacing.md }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Width</label>
                <InputNumber
                  value={data.parameters?.width || 1024}
                  onChange={(value) => updateParams('width', value)}
                  min={256}
                  max={2048}
                  step={64}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Height</label>
                <InputNumber
                  value={data.parameters?.height || 1024}
                  onChange={(value) => updateParams('height', value)}
                  min={256}
                  max={2048}
                  step={64}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Steps: {data.parameters?.steps || 30}</label>
              <Slider
                min={1}
                max={100}
                value={data.parameters?.steps || 30}
                onChange={(value) => updateParams('steps', value)}
              />
            </div>

            <div>
              <label style={labelStyle}>CFG Scale: {data.parameters?.cfgScale || 7}</label>
              <Slider
                min={1}
                max={20}
                step={0.5}
                value={data.parameters?.cfgScale || 7}
                onChange={(value) => updateParams('cfgScale', value)}
              />
            </div>

            <div>
              <label style={labelStyle}>Seed</label>
              <InputNumber
                value={data.parameters?.seed}
                onChange={(value) => updateParams('seed', value)}
                placeholder="Random"
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {/* 文生视频/图生视频/视频生视频/视频超分 */}
        {(data.type === 'text-to-video' || data.type === 'image-to-video' ||
          data.type === 'video-to-video' || data.type === 'video-upscale') && (
          <>
            <div>
              <label style={labelStyle}>模型</label>
              <ModelSelect
                nodeType={data.type}
                value={data.modelId}
                onChange={(value) => onUpdate({ modelId: value })}
              />
            </div>

            <div>
              <label style={labelStyle}>Prompt</label>
              <Input.TextArea
                value={data.parameters?.prompt || ''}
                onChange={(e) => updateParams('prompt', e.target.value)}
                placeholder="Describe the video motion..."
                rows={3}
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>Duration (seconds)</label>
              <Slider
                min={1}
                max={30}
                value={data.parameters?.duration || 4}
                onChange={(value) => updateParams('duration', value)}
                marks={{
                  1: '1s',
                  4: '4s',
                  8: '8s',
                  15: '15s',
                  30: '30s',
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>Resolution</label>
              <Select
                value={data.parameters?.resolution || '720p'}
                onChange={(value) => updateParams('resolution', value)}
                style={{ width: '100%' }}
                options={[
                  { label: '480p', value: '480p' },
                  { label: '720p', value: '720p' },
                  { label: '1080p', value: '1080p' },
                  { label: '4K', value: '4k' },
                ]}
              />
            </div>

            <div>
              <label style={labelStyle}>FPS</label>
              <Select
                value={data.parameters?.fps || 24}
                onChange={(value) => updateParams('fps', value)}
                style={{ width: '100%' }}
                options={[
                  { label: '15 fps', value: 15 },
                  { label: '24 fps', value: 24 },
                  { label: '30 fps', value: 30 },
                  { label: '60 fps', value: 60 },
                ]}
              />
            </div>
          </>
        )}

        {/* AI Agent 节点 */}
        {(data.type === 'ai-chat' || data.type === 'script-writer' || data.type === 'storyboard') && (
          <>
            <div>
              <label style={labelStyle}>Agent Type</label>
              <Select
                value={data.parameters?.agentType || 'inspiration'}
                onChange={(value) => updateParams('agentType', value)}
                style={{ width: '100%' }}
                options={[
                  { label: '灵感 Agent - 生成创意和提示词', value: 'inspiration' },
                  { label: '导演 Agent - 自动编排工作流', value: 'director' },
                  { label: '优化 Agent - 优化参数和提示词', value: 'optimizer' },
                ]}
              />
            </div>

            <div>
              <label style={labelStyle}>Model</label>
              <Select
                value={data.modelId}
                onChange={(value) => onUpdate({ modelId: value })}
                placeholder="Select AI model"
                style={{ width: '100%' }}
                options={[
                  { label: 'GPT-4o', value: 'gpt-4o' },
                  { label: 'Claude 3.5', value: 'claude-3.5' },
                  { label: 'Gemini Pro', value: 'gemini-pro' },
                ]}
              />
            </div>

            <div>
              <label style={labelStyle}>Prompt</label>
              <Input.TextArea
                value={data.parameters?.prompt || ''}
                onChange={(e) => updateParams('prompt', e.target.value)}
                placeholder="Describe what you want the AI to do..."
                rows={4}
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>
          </>
        )}

        {/* 文字转语音 */}
        {data.type === 'text-to-speech' && (
          <>
            <div>
              <label style={labelStyle}>模型</label>
              <ModelSelect
                nodeType={data.type}
                value={data.modelId}
                onChange={(value) => onUpdate({ modelId: value })}
              />
            </div>

            <div>
              <label style={labelStyle}>Voice</label>
              <Select
                value={data.parameters?.voice || 'default'}
                onChange={(value) => updateParams('voice', value)}
                style={{ width: '100%' }}
                options={[
                  { label: 'Default', value: 'default' },
                  { label: 'Male', value: 'male' },
                  { label: 'Female', value: 'female' },
                  { label: 'Child', value: 'child' },
                ]}
              />
            </div>

            <div>
              <label style={labelStyle}>Language</label>
              <Select
                value={data.parameters?.language || 'zh-CN'}
                onChange={(value) => updateParams('language', value)}
                style={{ width: '100%' }}
                options={[
                  { label: '中文', value: 'zh-CN' },
                  { label: 'English', value: 'en-US' },
                  { label: '日本語', value: 'ja-JP' },
                  { label: '한국어', value: 'ko-KR' },
                ]}
              />
            </div>

            <div>
              <label style={labelStyle}>Speed: {data.parameters?.speed || 1.0}x</label>
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                value={data.parameters?.speed || 1.0}
                onChange={(value) => updateParams('speed', value)}
              />
            </div>
          </>
        )}

        {/* 音乐生成 */}
        {data.type === 'music-generation' && (
          <>
            <div>
              <label style={labelStyle}>模型</label>
              <ModelSelect
                nodeType={data.type}
                value={data.modelId}
                onChange={(value) => onUpdate({ modelId: value })}
              />
            </div>

            <div>
              <label style={labelStyle}>Music Description</label>
              <Input.TextArea
                value={data.parameters?.prompt || ''}
                onChange={(e) => updateParams('prompt', e.target.value)}
                placeholder="Describe the music style and mood..."
                rows={3}
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>Duration: {data.parameters?.duration || 30}s</label>
              <Slider
                min={10}
                max={180}
                step={10}
                value={data.parameters?.duration || 30}
                onChange={(value) => updateParams('duration', value)}
              />
            </div>
          </>
        )}


        {/* 条件节点配置 */}
        {data.type === 'condition' && (
          <div>
            <label style={labelStyle}>Conditions</label>
            {(data.conditions || []).map((cond, index) => (
              <div key={index} style={{ marginBottom: tokens.spacing.sm }}>
                <Input
                  value={cond.expression}
                  onChange={(e) => {
                    const newConditions = [...(data.conditions || [])];
                    newConditions[index] = { ...cond, expression: e.target.value };
                    onUpdate({ conditions: newConditions });
                  }}
                  placeholder="Condition expression"
                  style={{
                    background: tokens.bg.tertiary,
                    borderColor: tokens.border.default,
                    marginBottom: tokens.spacing.xs,
                  }}
                />
                <Input
                  value={cond.branchId}
                  onChange={(e) => {
                    const newConditions = [...(data.conditions || [])];
                    newConditions[index] = { ...cond, branchId: e.target.value };
                    onUpdate({ conditions: newConditions });
                  }}
                  placeholder="Branch ID"
                  size="small"
                  style={{
                    background: tokens.bg.tertiary,
                    borderColor: tokens.border.default,
                  }}
                />
              </div>
            ))}
            <Button
              size="small"
              onClick={() => {
                const newConditions = [
                  ...(data.conditions || []),
                  { expression: '', branchId: `branch-${Date.now()}` },
                ];
                onUpdate({ conditions: newConditions });
              }}
              style={{
                background: tokens.bg.elevated,
                borderColor: tokens.border.default,
                color: tokens.text.primary,
              }}
            >
              Add Condition
            </Button>
          </div>
        )}

        {/* 循环节点配置 */}
        {data.type === 'loop' && (
          <>
            <div>
              <label style={labelStyle}>Array Reference</label>
              <Input
                value={data.loopConfig?.inputArray}
                onChange={(e) =>
                  onUpdate({
                    loopConfig: { ...data.loopConfig, inputArray: e.target.value } as any,
                  })
                }
                placeholder="$input.array"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>
            <div>
              <label style={labelStyle}>Output Mode</label>
              <Select
                value={data.loopConfig?.outputMode || 'collect'}
                onChange={(value) =>
                  onUpdate({
                    loopConfig: { ...data.loopConfig, outputMode: value } as any,
                  })
                }
                style={{ width: '100%' }}
                options={[
                  { label: 'Collect all results', value: 'collect' },
                  { label: 'Last result only', value: 'last' },
                ]}
              />
            </div>
            <div>
              <label style={labelStyle}>Parallelism</label>
              <Select
                value={data.loopConfig?.parallelism || 'sequential'}
                onChange={(value) =>
                  onUpdate({
                    loopConfig: { ...data.loopConfig, parallelism: value } as any,
                  })
                }
                style={{ width: '100%' }}
                options={[
                  { label: 'Sequential', value: 'sequential' },
                  { label: 'Parallel', value: 'parallel' },
                ]}
              />
            </div>
          </>
        )}

        {/* 转换节点配置 */}
        {data.type === 'transform' && (
          <div>
            <label style={labelStyle}>Transform Expression</label>
            <Input.TextArea
              value={data.transform?.expression}
              onChange={(e) =>
                onUpdate({
                  transform: { expression: e.target.value },
                })
              }
              placeholder="$input.value * 2"
              rows={3}
              style={{
                background: tokens.bg.tertiary,
                borderColor: tokens.border.default,
              }}
            />
          </div>
        )}

        <Divider style={{ borderColor: tokens.border.default }} />

        {/* 单节点运行 */}
        {onRun && nodeTypeSupportsModel(data.type) && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={onRun}
            block
            style={{ background: tokens.accent.gradient, border: 'none', marginBottom: tokens.spacing.sm }}
          >
            运行此节点
          </Button>
        )}

        {/* 删除按钮 */}
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={onDelete}
          block
          style={{
            background: `${tokens.status.error}20`,
            borderColor: tokens.status.error,
          }}
        >
          Delete Node
        </Button>
      </Space>
    </div>
  );
}
