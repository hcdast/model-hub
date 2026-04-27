import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import { ModelConfigEditor } from '../components/ModelConfigEditor';
import { TemplateSelector } from '../components/TemplateSelector';
import { LoadingState } from '../components/LoadingState';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

const { Title } = Typography;

/**
 * 创建模型配置页面
 * 提供 JSON 编辑器界面用于创建新的模型配置
 */
export default function CreateModelConfigPage() {
  const navigate = useNavigate();
  const [jsonValue, setJsonValue] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // 加载默认模板
  useEffect(() => {
    // 提供一个基础的默认模板
    const defaultTemplate = {
      model_name: '',
      model_type: 40001,
      provider: '',
      provider_model_name: '',
      service: '',
      group: '',
      label: '',
      description: '',
      tags: [],
      sort: 100,
      disabled: false,
      unusable: false,
      display: true,
      unit_credit_map: {
        default: 1,
      },
      unit_price_map: {
        default: {
          cost_unit_price: 0,
          sale_unit_price: 0.01,
          unit_credit: 1,
          original_unit_credit: 1,
        },
      },
      duration_step: 1,
      audio_extra_credit_multiplier: 1,
      discount: {},
      requires_pay: false,
      requires_priority: 10,
      requires_priority_4_unlimit_mode: -1,
      supported_unlimit_mode: false,
      supported_unlimit_mode_start_time: 0,
      max_count: 1,
      batch_quantity: [1],
      params: {},
    };

    setJsonValue(JSON.stringify(defaultTemplate, null, 2));
    setLoading(false);
  }, []);

  // 加载模板
  const handleTemplateLoad = (template: Record<string, any>) => {
    setJsonValue(JSON.stringify(template, null, 2));
    ErrorHandler.showSuccess('模板已加载');
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
      const res: any = await modelApi.create(config);
      
      if (res.code === 0) {
        ErrorHandler.showSuccess('创建成功');
        // 延迟跳转，让用户看到成功提示
        setTimeout(() => {
          navigate('/models');
        }, 1000);
      } else {
        // 处理业务错误（使用统一错误处理）
        ErrorHandler.handleApiError({ response: { data: res } }, '创建失败');
      }
    } catch (err: any) {
      // 使用统一错误处理
      ErrorHandler.handleApiError(err, '创建失败');
      console.error('Failed to create model config:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // 返回列表
  const handleCancel = () => {
    navigate('/models');
  };

  if (loading) {
    return <LoadingState tip="加载模板中..." large />;
  }

  return (
    <div>
      {/* 页面头部 */}
      <Space style={{ marginBottom: 16 }} align="center">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={handleCancel}
        >
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          创建模型配置
        </Title>
      </Space>

      {/* 编辑器卡片 */}
      <Card>
        {/* 模板选择器 */}
        <TemplateSelector onChange={handleTemplateLoad} />

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
