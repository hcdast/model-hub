import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Typography,
  Segmented,
  Alert,
  Row,
  Col,
} from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  AppstoreOutlined,
  CodeOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { ModelConfigEditor } from '../components/ModelConfigEditor';
import {
  ModelConfigStructuredEditor,
  ClientParamPreview,
} from '../components/ModelConfigStructuredEditor';
import { TemplateSelector } from '../components/TemplateSelector';
import { LoadingState } from '../components/LoadingState';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

type ConfigEditMode = 'structured' | 'json';

/**
 * 创建模型配置页面
 * 左侧：结构化编辑 / JSON；右侧：客户端表单实时预览
 */
export default function CreateModelConfigPage() {
  const navigate = useNavigate();
  const [jsonValue, setJsonValue] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState<ConfigEditMode>('structured');
  const [structuredSession, setStructuredSession] = useState(0);

  const structuredPayload = useMemo(() => {
    try {
      return { ok: true as const, data: JSON.parse(jsonValue) as Record<string, any> };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [jsonValue]);

  useEffect(() => {
    const defaultTemplate = {
      model_id: '',
      model_type: 'textToImage',
      provider: '',
      provider_model_name: '',
      model_name: '',
      description: '',
      tags: [],
      sort: 100,
      disabled: false,
      unit_price_map: {
        default: {
          cost_unit_price: 0,
          sale_unit_price: 0.01,
          unit_credit: 1,
          original_unit_credit: 1,
        },
      },
      params: {},
    };

    setJsonValue(JSON.stringify(defaultTemplate, null, 2));
    setLoading(false);
  }, []);

  const handleTemplateLoad = (template: Record<string, any>) => {
    setJsonValue(JSON.stringify(template, null, 2));
    setEditMode('structured');
    setStructuredSession((s) => s + 1);
    ErrorHandler.showSuccess('模板已加载');
  };

  const handleSubmit = async () => {
    if (validationErrors.length > 0) {
      ErrorHandler.showWarning('请先修复 JSON 格式错误');
      return;
    }

    let config: any;
    try {
      config = JSON.parse(jsonValue);
    } catch {
      ErrorHandler.showWarning('JSON 格式错误，无法解析');
      return;
    }

    const requiredFields = ['model_id', 'model_type', 'provider', 'model_name', 'unit_price_map'];
    const missingFields = requiredFields.filter((field) => !config[field]);
    if (missingFields.length > 0) {
      ErrorHandler.showWarning(`缺少必填字段: ${missingFields.join(', ')}`);
      return;
    }

    setSubmitting(true);
    try {
      const res: any = await modelApi.create(config);

      if (res.code === 0) {
        ErrorHandler.showSuccess('创建成功');
        setTimeout(() => {
          navigate('/models');
        }, 1000);
      } else {
        ErrorHandler.handleApiError({ response: { data: res } }, '创建失败');
      }
    } catch (err: any) {
      ErrorHandler.handleApiError(err, '创建失败');
      console.error('Failed to create model config:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/models');
  };

  if (loading) {
    return <LoadingState tip="加载模板中..." large />;
  }

  return (
    <div>
      <PageHeader
        title="创建模型配置"
        prefix={(
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
            返回
          </Button>
        )}
      />

      <Card>
        <TemplateSelector onChange={handleTemplateLoad} />

        <Row gutter={[16, 16]} align="stretch" style={{ marginTop: 16 }}>
          <Col xs={24} xl={14}>
            <Segmented
              value={editMode}
              onChange={(value) => {
                const v = value as ConfigEditMode;
                if (v === 'structured') {
                  setStructuredSession((s) => s + 1);
                }
                setEditMode(v);
              }}
              options={[
                {
                  value: 'structured',
                  icon: <AppstoreOutlined />,
                  label: '结构化编辑',
                },
                {
                  value: 'json',
                  icon: <CodeOutlined />,
                  label: 'JSON 模式',
                },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              {editMode === 'json' ? (
                <ModelConfigEditor
                  value={jsonValue}
                  onChange={setJsonValue}
                  onValidate={setValidationErrors}
                  height="min(70vh, 620px)"
                />
              ) : !structuredPayload.ok ? (
                <Alert
                  type="error"
                  showIcon
                  message="当前 JSON 无法解析"
                  description={structuredPayload.error}
                  action={(
                    <Button size="small" type="primary" onClick={() => setEditMode('json')}>
                      切换到 JSON 模式
                    </Button>
                  )}
                />
              ) : (
                <ModelConfigStructuredEditor
                  key={structuredSession}
                  value={structuredPayload.data}
                  onChange={(next) => setJsonValue(JSON.stringify(next, null, 2))}
                />
              )}
            </div>
          </Col>
          <Col xs={24} xl={10}>
            <Card
              size="small"
              title={(
                <Space size={8}>
                  <EyeOutlined />
                  <span>客户端展示</span>
                </Space>
              )}
              styles={{
                body: {
                  maxHeight: 'calc(100vh - 200px)',
                  overflowY: 'auto',
                },
              }}
              style={{ position: 'sticky', top: 0 }}
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
                左侧编辑会同步更新当前配置；此处按 params 定义实时渲染只读预览。
              </Typography.Paragraph>
              {structuredPayload.ok ? (
                <ClientParamPreview embedded definitions={structuredPayload.data.params} />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message="无法预览"
                  description="JSON 无法解析时，请先在左侧 JSON 模式中修正格式。"
                />
              )}
            </Card>
          </Col>
        </Row>

        {validationErrors.length > 0 && (
          <div style={{ marginTop: 16, color: '#ff4d4f' }}>
            <Typography.Text type="danger">
              发现 {validationErrors.length} 个错误，请修复后再提交
            </Typography.Text>
          </div>
        )}

        <Space style={{ marginTop: 24 }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={validationErrors.length > 0}
          >
            创建配置
          </Button>
          <Button onClick={handleCancel}>
            取消
          </Button>
        </Space>
      </Card>
    </div>
  );
}
