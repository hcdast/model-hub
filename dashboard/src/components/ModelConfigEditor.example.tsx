/**
 * ModelConfigEditor 使用示例
 * 
 * 这个文件展示了如何在实际页面中使用 ModelConfigEditor 组件
 */

import React, { useState } from 'react';
import { ModelConfigEditor } from './ModelConfigEditor';
import { Button, Space, message, Card, Alert } from 'antd';

// ============================================
// 示例 1: 基础使用
// ============================================
export const BasicExample: React.FC = () => {
  const [jsonValue, setJsonValue] = useState(`{
  "model_id": "wavespeed-ai/example-model/text-to-image",
  "model_type": "textToImage",
  "provider": "wavespeed-ai",
  "model_name": "示例模型"
}`);

  return (
    <Card title="示例 1: 基础使用">
      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
      />
    </Card>
  );
};

// ============================================
// 示例 2: 带验证的编辑器
// ============================================
export const ValidationExample: React.FC = () => {
  const [jsonValue, setJsonValue] = useState('{}');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);

  const handleSubmit = () => {
    if (validationErrors.length > 0) {
      message.error('请先修正 JSON 格式错误');
      return;
    }

    try {
      const config = JSON.parse(jsonValue);
      console.log('提交的配置:', config);
      message.success('提交成功');
    } catch (error) {
      message.error('提交失败');
    }
  };

  return (
    <Card title="示例 2: 带验证的编辑器">
      {validationErrors.length > 0 && (
        <Alert
          message="JSON 格式错误"
          description={
            <ul>
              {validationErrors.map((error, index) => (
                <li key={index}>
                  行 {error.startLineNumber}, 列 {error.startColumn}: {error.message}
                </li>
              ))}
            </ul>
          }
          type="error"
          style={{ marginBottom: 16 }}
        />
      )}

      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
        onValidate={setValidationErrors}
      />

      <Button
        type="primary"
        onClick={handleSubmit}
        disabled={validationErrors.length > 0}
        style={{ marginTop: 16 }}
      >
        提交配置
      </Button>
    </Card>
  );
};

// ============================================
// 示例 3: 只读模式
// ============================================
export const ReadOnlyExample: React.FC = () => {
  const jsonValue = JSON.stringify({
    model_id: 'wavespeed-ai/readonly-model/text-to-image',
    model_type: 'textToImage',
    provider: 'wavespeed-ai',
    model_name: '只读模型',
    description: '这是一个只读配置示例',
  }, null, 2);

  return (
    <Card title="示例 3: 只读模式">
      <Alert
        message="只读模式"
        description="此编辑器为只读模式，无法编辑内容"
        type="info"
        style={{ marginBottom: 16 }}
      />
      
      <ModelConfigEditor
        value={jsonValue}
        onChange={() => {}}
        readOnly={true}
        height="400px"
      />
    </Card>
  );
};

// ============================================
// 示例 4: 自定义高度
// ============================================
export const CustomHeightExample: React.FC = () => {
  const [jsonValue, setJsonValue] = useState(JSON.stringify({
    model_id: 'wavespeed-ai/custom-height-model/text-to-image',
    model_type: 'textToImage',
    provider: 'wavespeed-ai',
    model_name: '自定义高度示例',
  }, null, 2));

  return (
    <Card title="示例 4: 自定义高度">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message="自定义高度"
          description="编辑器高度设置为 300px"
          type="info"
        />
        
        <ModelConfigEditor
          value={jsonValue}
          onChange={setJsonValue}
          height="300px"
        />
      </Space>
    </Card>
  );
};

// ============================================
// 示例 5: 完整的创建配置流程
// ============================================
export const CompleteCreateExample: React.FC = () => {
  const defaultTemplate = {
    model_id: '',
    model_type: 'textToImage',
    provider: '',
    model_name: '',
    provider_model_name: '',
    description: '',
    tags: [],
    sort: 100,
    disabled: false,
    unit_price_map: {
      default: {
        cost_unit_price: 0,
        sale_unit_price: 0.01,
        unit_credit: 1,
        original_unit_credit: 1
      }
    },
    params: {}
  };

  const [jsonValue, setJsonValue] = useState(JSON.stringify(defaultTemplate, null, 2));
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (validationErrors.length > 0) {
      message.error('请先修正 JSON 格式错误');
      return;
    }

    try {
      const config = JSON.parse(jsonValue);
      
      // 验证必填字段
      const requiredFields = ['model_id', 'model_type', 'provider', 'model_name', 'unit_price_map'];
      const missingFields = requiredFields.filter(field => !config[field]);
      
      if (missingFields.length > 0) {
        message.error(`缺少必填字段: ${missingFields.join(', ')}`);
        return;
      }

      setSubmitting(true);
      
      // 模拟 API 调用
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('创建配置:', config);
      message.success('配置创建成功');
      
      setSubmitting(false);
    } catch (error: any) {
      message.error(`创建失败: ${error.message}`);
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setJsonValue(JSON.stringify(defaultTemplate, null, 2));
    message.info('已重置为默认模板');
  };

  return (
    <Card title="示例 5: 完整的创建配置流程">
      <Alert
        message="创建新配置"
        description="填写所有必填字段后提交创建"
        type="info"
        style={{ marginBottom: 16 }}
      />

      <ModelConfigEditor
        value={jsonValue}
        onChange={setJsonValue}
        onValidate={setValidationErrors}
      />

      <Space style={{ marginTop: 16 }}>
        <Button
          type="primary"
          onClick={handleSubmit}
          disabled={validationErrors.length > 0}
          loading={submitting}
        >
          创建配置
        </Button>
        <Button onClick={handleReset}>
          重置
        </Button>
      </Space>
    </Card>
  );
};

// ============================================
// 所有示例的集合页面
// ============================================
export const AllExamples: React.FC = () => {
  return (
    <div style={{ padding: '24px' }}>
      <h1>ModelConfigEditor 使用示例</h1>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <BasicExample />
        <ValidationExample />
        <ReadOnlyExample />
        <CustomHeightExample />
        <CompleteCreateExample />
      </Space>
    </div>
  );
};

export default AllExamples;
