import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Typography,
  Modal,
  Segmented,
  Alert,
  Row,
  Col,
} from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  ReloadOutlined,
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
import { LoadingState } from '../components/LoadingState';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

type ConfigEditMode = 'structured' | 'json';

/**
 * 编辑模型配置页面
 * 左侧：结构化编辑 / JSON；右侧：客户端表单实时预览
 */
export default function EditModelConfigPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [jsonValue, setJsonValue] = useState<string>('');
  const [originalValue, setOriginalValue] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [mongoId, setMongoId] = useState<string>('');
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
    if (!id) {
      ErrorHandler.showWarning('缺少配置 ID');
      navigate('/models');
      return;
    }

    loadConfig(id);
  }, [id]);

  useEffect(() => {
    setHasChanges(jsonValue !== originalValue);
  }, [jsonValue, originalValue]);

  const loadConfig = async (modelName: string) => {
    setLoading(true);
    try {
      const res: any = await modelApi.getDetail(modelName);

      if (res.code === 0 && res.data) {
        setMongoId(res.data._id);
        const formattedJson = JSON.stringify(res.data, null, 2);
        setJsonValue(formattedJson);
        setOriginalValue(formattedJson);
        setEditMode('structured');
        setStructuredSession(0);
      } else {
        ErrorHandler.handleApiError({ response: { data: res } }, '加载配置失败');
        navigate('/models');
      }
    } catch (err: any) {
      console.error('Failed to load model config:', err);
      ErrorHandler.handleApiError(err, '加载配置失败');
      navigate('/models');
    } finally {
      setLoading(false);
    }
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
      const updateId = mongoId || config._id || id!;
      const res: any = await modelApi.update(updateId, config);

      if (res.code === 0) {
        ErrorHandler.showSuccess('更新成功');
        const formattedJson = JSON.stringify(res.data, null, 2);
        setOriginalValue(formattedJson);
        setJsonValue(formattedJson);
        setHasChanges(false);

        setTimeout(() => {
          navigate('/models');
        }, 1000);
      } else {
        ErrorHandler.handleApiError({ response: { data: res } }, '更新失败');
      }
    } catch (err: any) {
      ErrorHandler.handleApiError(err, '更新失败');
      console.error('Failed to update model config:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    Modal.confirm({
      title: '确认重置',
      content: '确定要放弃所有修改，恢复到原始配置吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setJsonValue(originalValue);
        ErrorHandler.showInfo('已恢复到原始配置');
      },
    });
  };

  const handleCancel = () => {
    if (hasChanges) {
      Modal.confirm({
        title: '确认离开',
        content: '您有未保存的修改，确定要离开吗？',
        okText: '离开',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => {
          navigate('/models');
        },
      });
    } else {
      navigate('/models');
    }
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasChanges]);

  if (loading) {
    return <LoadingState tip="加载配置中..." large />;
  }

  return (
    <div>
      <PageHeader
        title="编辑模型配置"
        subtitle={hasChanges ? '有未保存的修改' : undefined}
        prefix={(
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
            返回
          </Button>
        )}
      />

      <Card>
        <Row gutter={[16, 16]} align="stretch">
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
                左侧编辑会同步更新当前配置；此处按 params 定义实时渲染只读预览（类 Markdown 分栏效果）。
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
            disabled={!hasChanges || validationErrors.length > 0}
          >
            保存修改
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={!hasChanges}
          >
            重置
          </Button>
          <Button onClick={handleCancel}>
            取消
          </Button>
        </Space>
      </Card>
    </div>
  );
}
