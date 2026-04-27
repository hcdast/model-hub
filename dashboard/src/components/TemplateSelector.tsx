import { useState, useEffect } from 'react';
import { Select, Space, Typography, message } from 'antd';
import { modelApi } from '../services/api';

const { Text } = Typography;

interface Template {
  type: string;
  name: string;
  template: Record<string, any>;
}

interface TemplateSelectorProps {
  onChange: (template: Record<string, any>) => void;
}

/**
 * 模板选择器组件
 * 允许用户选择预定义的配置模板
 */
export function TemplateSelector({ onChange }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');

  // 加载模板列表
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const res: any = await modelApi.getTemplates();
        if (res.code === 0 && res.data?.templates) {
          setTemplates(res.data.templates);
        } else {
          message.error('加载模板失败');
        }
      } catch (err) {
        message.error('加载模板失败');
        console.error('Failed to load templates:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  // 处理模板选择
  const handleTemplateChange = (type: string) => {
    setSelectedType(type);
    const template = templates.find((t) => t.type === type);
    if (template) {
      onChange(template.template);
    }
  };

  return (
    <Space align="center" style={{ marginBottom: 16 }}>
      <Text>选择模板：</Text>
      <Select
        style={{ width: 200 }}
        placeholder="请选择配置模板"
        loading={loading}
        value={selectedType || undefined}
        onChange={handleTemplateChange}
        options={templates.map((t) => ({
          label: t.name,
          value: t.type,
        }))}
        allowClear
        onClear={() => setSelectedType('')}
      />
      <Text type="secondary">
        选择模板后将加载预定义的配置到编辑器
      </Text>
    </Space>
  );
}
