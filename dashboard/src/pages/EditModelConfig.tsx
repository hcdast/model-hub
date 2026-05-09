import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Typography,
  Modal,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { ModelConfigEditor } from '../components/ModelConfigEditor';
import { LoadingState } from '../components/LoadingState';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

/**
 * 编辑模型配置页面
 * 提供 JSON 编辑器界面用于编辑现有的模型配置
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

  // 加载配置数据
  useEffect(() => {
    if (!id) {
      ErrorHandler.showWarning('缺少配置 ID');
      navigate('/models');
      return;
    }

    loadConfig(id);
  }, [id]);

  // 检测变更
  useEffect(() => {
    setHasChanges(jsonValue !== originalValue);
  }, [jsonValue, originalValue]);

  // 加载配置
  const loadConfig = async (modelName: string) => {
    setLoading(true);
    try {
      const res: any = await modelApi.getDetail(modelName);
      
      if (res.code === 0 && res.data) {
        // 保存 MongoDB _id 用于更新接口
        setMongoId(res.data._id);
        // 格式化 JSON 并设置到编辑器
        const formattedJson = JSON.stringify(res.data, null, 2);
        setJsonValue(formattedJson);
        setOriginalValue(formattedJson);
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

  // 处理提交
  const handleSubmit = async () => {
    // 检查是否有验证错误
    if (validationErrors.length > 0) {
      ErrorHandler.showWarning('请先修复 JSON 格式错误');
      return;
    }

    // 解析 JSON
    let config: any;
    try {
      config = JSON.parse(jsonValue);
    } catch (err) {
      ErrorHandler.showWarning('JSON 格式错误，无法解析');
      return;
    }

    // 验证必填字段
    const requiredFields = ['model_name', 'model_type', 'provider', 'label', 'service'];
    const missingFields = requiredFields.filter((field) => !config[field]);
    if (missingFields.length > 0) {
      ErrorHandler.showWarning(`缺少必填字段: ${missingFields.join(', ')}`);
      return;
    }

    // 提交到后端
    setSubmitting(true);
    try {
      const updateId = mongoId || config._id || id!;
      const res: any = await modelApi.update(updateId, config);
      
      if (res.code === 0) {
        ErrorHandler.showSuccess('更新成功');
        // 更新原始值，避免离开页面时提示未保存
        const formattedJson = JSON.stringify(res.data, null, 2);
        setOriginalValue(formattedJson);
        setJsonValue(formattedJson);
        setHasChanges(false);
        
        // 延迟跳转，让用户看到成功提示
        setTimeout(() => {
          navigate('/models');
        }, 1000);
      } else {
        // 处理业务错误（使用统一错误处理）
        ErrorHandler.handleApiError({ response: { data: res } }, '更新失败');
      }
    } catch (err: any) {
      // 使用统一错误处理
      ErrorHandler.handleApiError(err, '更新失败');
      console.error('Failed to update model config:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // 重置到原始值
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

  // 返回列表
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

  // 离开页面前确认
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        // 现代浏览器会显示默认的确认对话框
        // 不需要设置 returnValue
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
        <ModelConfigEditor
          value={jsonValue}
          onChange={setJsonValue}
          onValidate={setValidationErrors}
        />

        {/* 验证错误提示 */}
        {validationErrors.length > 0 && (
          <div style={{ marginTop: 16, color: '#ff4d4f' }}>
            <Typography.Text type="danger">
              发现 {validationErrors.length} 个错误，请修复后再提交
            </Typography.Text>
          </div>
        )}

        {/* 操作按钮 */}
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
