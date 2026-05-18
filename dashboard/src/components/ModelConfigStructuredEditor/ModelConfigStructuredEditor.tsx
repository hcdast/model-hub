import { useCallback, useEffect, useRef } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
} from 'antd';
import type { ParamDefinitions } from '@model-hub/common/interfaces/param-definition.interface';
import { BASIC_FIELD_NAMES } from './constants';
import { pickBasic } from './helpers';
import { ParamDefinitionsEditor } from './ParamDefinitionsEditor';
import { UnitPriceMapSection } from './UnitPriceMapSection';
import { MODEL_CONFIG_MODEL_TYPES } from '../../constants/model-config-model-type';
import ProviderSelect from '../ProviderSelect';

const MODEL_TYPE_SELECT_OPTIONS = MODEL_CONFIG_MODEL_TYPES.map((v) => ({
  label: v,
  value: v,
}));

export interface ModelConfigStructuredEditorProps {
  /** 完整模型配置对象（已 JSON.parse） */
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}

export function ModelConfigStructuredEditor({
  value,
  onChange,
}: ModelConfigStructuredEditorProps) {
  const valueRef = useRef(value);
  valueRef.current = value;

  const emit = useCallback(
    (patch: Record<string, any>) => {
      onChange({ ...valueRef.current, ...patch });
    },
    [onChange],
  );

  const [basicForm] = Form.useForm();
  const providerValue = Form.useWatch('provider', basicForm);

  const basicSlice = JSON.stringify(pickBasic(value));
  useEffect(() => {
    basicForm.setFieldsValue(pickBasic(valueRef.current));
  }, [basicSlice, basicForm]);

  const flushBasic = () => {
    const raw = basicForm.getFieldsValue(true) as Record<string, unknown>;
    const nextBasic: Record<string, unknown> = {};
    for (const k of BASIC_FIELD_NAMES) {
      if (raw[k] !== undefined) nextBasic[k] = raw[k];
    }
    emit({ ...valueRef.current, ...nextBasic });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="基础信息">
        <Form
          form={basicForm}
          layout="vertical"
          initialValues={pickBasic(value)}
          onValuesChange={flushBasic}
        >
          <Form.Item
            name="model_id"
            label="model_id"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="与创建任务时的 model 一致" />
          </Form.Item>
          <Form.Item
            name="model_type"
            label="model_type"
            rules={[{ required: true, message: '必填' }]}
          >
            <Select options={MODEL_TYPE_SELECT_OPTIONS} placeholder="camelCase 能力类型" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="provider"
            label="provider（Adapter 注册名）"
            rules={[{ required: true, message: '必填' }]}
          >
            <ProviderSelect
              extraValues={providerValue ? [String(providerValue)] : undefined}
            />
          </Form.Item>
          <Form.Item name="provider_model_name" label="provider_model_name">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="model_name"
            label="model_name（展示名称）"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="tags" label="tags">
            <Select mode="tags" placeholder="输入后回车添加" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort" label="sort">
            <InputNumber style={{ width: '100%' }} step={1} />
          </Form.Item>
          <Form.Item name="disabled" label="disabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      <UnitPriceMapSection
        unitPriceMap={
          value.unit_price_map && typeof value.unit_price_map === 'object'
            ? value.unit_price_map
            : { default: {} }
        }
        onChange={(unit_price_map) => emit({ unit_price_map })}
      />

      <ParamDefinitionsEditor
        params={
          value.params && typeof value.params === 'object' && !Array.isArray(value.params)
            ? (value.params as ParamDefinitions)
            : {}
        }
        onChange={(params) => emit({ params })}
      />
    </Space>
  );
}
