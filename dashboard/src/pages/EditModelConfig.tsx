import Table from '../components/AdminTable';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Select,
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
import { PageActions } from '../components/PageFrame';
import { ModelConfigEditor } from '../components/ModelConfigEditor';
import {
  ModelConfigStructuredEditor,
  ClientParamPreview,
} from '../components/ModelConfigStructuredEditor';
import { LoadingState } from '../components/LoadingState';
import { modelApi } from '../services/api';
import { usePermission } from '../hooks/usePermission';
import { pickModelConfig } from '@model-hub/common/utils/model-contract';
import { ErrorHandler } from '../utils/error-handler';
import { useUnsavedNavigation } from '../hooks/useUnsavedNavigation';

type ConfigEditMode = 'structured' | 'json';

/**
 * 编辑模型配置页面
 * 左侧：结构化编辑 / JSON；右侧：客户端表单实时预览
 */
export default function EditModelConfigPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const requestedReturn = search.get('returnTo') || '/models';
  const returnTo = /^\/models(?:\?|$)/.test(requestedReturn) ? requestedReturn : '/models';
  const { hasPermission } = usePermission(); const canUpdate = hasPermission('model:update');
  const [historyRevision, setHistoryRevision] = useState<number>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const diff = (before: any, after: any) => [...new Set([...Object.keys(pickModelConfig(before)), ...Object.keys(pickModelConfig(after))])].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(field => ({ field, before: before[field], after: after[field] }));
  const review = (title: string, before: any, after: any, action: () => Promise<void>) => Modal.confirm({ title, width: 1000, content: <Table size="small" rowKey="field" pagination={false} scroll={{ y: 420 }} dataSource={diff(before, after)} columns={[{ title: '字段', dataIndex: 'field', width: 160 }, { title: '当前', dataIndex: 'before', render: v => <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(v, null, 2)}</pre> }, { title: '更新后', dataIndex: 'after', render: v => <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(v, null, 2)}</pre> }]} />, onOk: action });
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [jsonValue, setJsonValue] = useState<string>('');
  const [originalValue, setOriginalValue] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  useUnsavedNavigation(hasChanges);
  const [mongoId, setMongoId] = useState<string>('');
  const [editMode, setEditMode] = useState<ConfigEditMode>('structured');
  const [structuredSession, setStructuredSession] = useState(0);
  const [activeConfig, setActiveConfig] = useState<Record<string, any>>({});

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
      navigate(returnTo);
      return;
    }

    loadConfig(id);
  }, [id]);

  useEffect(() => {
    setHasChanges(jsonValue !== originalValue);
  }, [jsonValue, originalValue]);

  const loadConfig = async (mongoId: string) => {
    setLoading(true);
    try {
      const res: any = await modelApi.getDetail(mongoId, { byMongoId: true });

      if (res.code === 0 && res.data) {
        setMongoId(res.data._id);
        setActiveConfig(res.data);
        const formattedJson = JSON.stringify(pickModelConfig(res.data), null, 2);
        setJsonValue(formattedJson);
        setOriginalValue(formattedJson);
        setEditMode('structured');
        setStructuredSession(0);
      } else {
        ErrorHandler.handleApiError({ response: { data: res } }, '加载配置失败');
        navigate(returnTo);
      }
    } catch (err: any) {
      console.error('Failed to load model config:', err);
      ErrorHandler.handleApiError(err, '加载配置失败');
      navigate(returnTo);
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
      const res: any = await modelApi.update(updateId, { ...config, expected_revision: activeConfig.revision || 0 });

      if (res.code === 0) {
        ErrorHandler.showSuccess('更新成功');
        const formattedJson = JSON.stringify(pickModelConfig(res.data), null, 2);
        setActiveConfig(res.data);
        setOriginalValue(formattedJson);
        setJsonValue(formattedJson);
        setHasChanges(false);

        setTimeout(() => {
          navigate(returnTo);
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

  const manageVersion = async (action: 'draft' | 'publish' | 'rollback', targetRevision?: number) => {
    setSubmitting(true);
    try {
      const config = JSON.parse(jsonValue);
      const revision = activeConfig.revision || 0;
      const res: any = action === 'draft' ? await modelApi.saveDraft(mongoId, config, revision, activeConfig.draft_revision || 0)
        : action === 'publish' ? await modelApi.publish(mongoId, revision, activeConfig.draft_revision || 0) : await modelApi.rollback(mongoId, revision, activeConfig.draft_revision || 0, targetRevision);
      if (res.code !== 0) throw new Error(res.message || '操作失败');
      setActiveConfig(res.data);
      const formatted = JSON.stringify(pickModelConfig(action === 'draft' ? { ...res.data, ...res.data.draft } : res.data), null, 2);
      setJsonValue(formatted); setOriginalValue(formatted); setHasChanges(false);
      ErrorHandler.showSuccess(action === 'draft' ? '草稿已保存，活动配置未改变' : action === 'publish' ? '已发布' : '已回滚');
    } catch (err) { ErrorHandler.handleApiError(err, '版本操作失败'); }
    finally { setSubmitting(false); }
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

  const handleCancel = () => navigate(returnTo);
  const loadDraft = () => {
    const apply = () => setJsonValue(JSON.stringify(pickModelConfig({ ...activeConfig, ...activeConfig.draft }), null, 2));
    if (!hasChanges) { apply(); return; }
    Modal.confirm({ title: '加载草稿将覆盖当前修改', content: '当前未保存的修改将丢失，是否加载已保存草稿？',
      okText: '加载草稿', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: apply });
  };

  if (loading) {
    return <LoadingState tip="加载配置中..." large />;
  }

  return (
    <div>
      <PageHeader
        title="编辑模型配置"
        subtitle={hasChanges ? '有未保存的修改' : undefined}
        toolbar={(
          <Space wrap>
            <span>活动版本 {activeConfig.revision || 0}</span>
            <Button loading={submitting} disabled={!canUpdate} onClick={() => manageVersion('draft')}>保存草稿</Button>
            <Button disabled={!activeConfig.draft || submitting} onClick={loadDraft}>加载草稿</Button>
            <Button type="primary" disabled={!canUpdate || !activeConfig.draft || submitting || hasChanges} onClick={() => review('发布草稿：立即生效', activeConfig, activeConfig.draft, () => manageVersion('publish'))}>发布已保存草稿</Button>
            <Button disabled={!activeConfig.history?.length || submitting} onClick={() => setHistoryOpen(true)}>历史版本与差异</Button>
          </Space>
        )}
        prefix={(
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
            返回
          </Button>
        )}
      />

      <Modal title="历史版本（最近 20 次发布）" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null} width={1000}>
        <Space><Select placeholder="选择历史版本" value={historyRevision} style={{ width: 340 }} onChange={setHistoryRevision} options={(activeConfig.history || []).map((h: any) => ({ value: h.revision, label: `版本 ${h.revision} · ${new Date(h.saved_at).toLocaleString()}` }))} /><Button danger disabled={!canUpdate || historyRevision === undefined} onClick={() => { const old = activeConfig.history.find((h: any) => h.revision === historyRevision); review(`回滚到版本 ${historyRevision}：立即生效`, activeConfig, old.config, async () => { await manageVersion('rollback', historyRevision); setHistoryOpen(false); }); }}>预览并回滚</Button></Space>
        <pre style={{ maxHeight: 440, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{historyRevision !== undefined && JSON.stringify(diff(activeConfig, activeConfig.history.find((h: any) => h.revision === historyRevision)?.config || {}), null, 2)}</pre>
      </Modal>
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

        <PageActions>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => review('保存并立即生效', activeConfig, structuredPayload.ok ? structuredPayload.data : {}, handleSubmit)}
            loading={submitting}
            disabled={!canUpdate || !hasChanges || validationErrors.length > 0}
          >
            保存并立即生效
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={!canUpdate || !hasChanges}
          >
            重置
          </Button>
          <Button onClick={handleCancel}>
            取消
          </Button>
        </PageActions>
      </Card>
    </div>
  );
}
