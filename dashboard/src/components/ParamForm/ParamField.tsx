/**
 * 单个参数字段渲染组件
 * 根据参数定义自动推断并渲染对应的表单控件
 */

import React, { useMemo } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Slider,
  Radio,
  Tag,
  Tooltip,
} from 'antd';
import type { ParamFieldProps, ParamUIType } from './types';
import {
  inferUIType,
  buildFormRules,
  getSelectOptions,
  getFilteredSelectOptions,
  formatParamLabel,
  isComplexArray,
} from './utils';

/**
 * 参数字段组件
 */
export const ParamField: React.FC<ParamFieldProps> = ({
  name,
  definition,
  disabled = false,
  fieldPrefix = ['params'],
}) => {
  const form = Form.useFormInstance();
  const depParam = definition.enumDependsOn?.param;
  const depPath = depParam ? [...fieldPrefix, depParam] : undefined;
  const depVal = depPath ? Form.useWatch(depPath, form) : undefined;

  const selectOptions = useMemo(() => {
    if (definition.enumDependsOn) {
      return getFilteredSelectOptions(definition, depVal);
    }
    return getSelectOptions(definition);
  }, [definition, depVal]);

  const uiType = inferUIType(name, definition);

  const rules = buildFormRules(name, definition);

  const fieldPath = [...fieldPrefix, name];

  const label =
    (definition.label && definition.label.trim()) || formatParamLabel(name);

  const labelNode = (
    <span>
      {label}
      {definition.third_party_field && (
        <Tooltip title={`请求厂商时映射为字段: ${definition.third_party_field}`}>
          <Tag color="blue" style={{ marginLeft: 8, fontSize: 12 }}>
            → {definition.third_party_field}
          </Tag>
        </Tooltip>
      )}
    </span>
  );

  const helpText = definition.description;

  const renderSelect = () => {
    return (
      <Select
        placeholder={`请选择 ${label}`}
        options={selectOptions}
        disabled={disabled}
        showSearch
        filterOption={(input, option) =>
          (option?.label ?? '')
            .toString()
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
    );
  };

  const renderRadio = () => {
    return (
      <Radio.Group disabled={disabled}>
        {selectOptions.map(opt => (
          <Radio key={String(opt.value)} value={opt.value}>
            {opt.label}
          </Radio>
        ))}
      </Radio.Group>
    );
  };

  const renderSwitch = () => {
    return <Switch disabled={disabled} />;
  };

  const renderInputNumber = () => {
    return (
      <InputNumber
        placeholder={getNumberPlaceholder()}
        min={definition.min}
        max={definition.max}
        disabled={disabled}
        style={{ width: '100%' }}
      />
    );
  };

  const renderSlider = () => {
    const min = definition.min ?? 0;
    const max = definition.max ?? 100;
    const marks: Record<number, string> = {
      [min]: String(min),
      [max]: String(max),
    };

    return (
      <Slider
        min={min}
        max={max}
        marks={marks}
        disabled={disabled}
      />
    );
  };

  const renderTextarea = () => {
    return (
      <Input.TextArea
        placeholder={`请输入 ${label}`}
        rows={4}
        disabled={disabled}
        showCount={definition.maxLength ? true : false}
        maxLength={definition.maxLength}
      />
    );
  };

  const renderTags = () => {
    if (isComplexArray(definition)) {
      return (
        <Input.TextArea
          placeholder={`请输入 JSON 数组格式`}
          rows={4}
          disabled={disabled}
        />
      );
    }

    return (
      <Select
        mode="tags"
        placeholder={`输入后按回车添加`}
        disabled={disabled}
        tokenSeparators={[',']}
      />
    );
  };

  const renderPassword = () => {
    return (
      <Input.Password
        placeholder={`请输入 ${label}`}
        disabled={disabled}
      />
    );
  };

  const renderInput = () => {
    return (
      <Input
        placeholder={`请输入 ${label}`}
        disabled={disabled}
        showCount={definition.maxLength ? true : false}
        maxLength={definition.maxLength}
      />
    );
  };

  const getNumberPlaceholder = (): string => {
    if (definition.min !== undefined && definition.max !== undefined) {
      return `${definition.min} - ${definition.max}`;
    }
    if (definition.min !== undefined) {
      return `最小值: ${definition.min}`;
    }
    if (definition.max !== undefined) {
      return `最大值: ${definition.max}`;
    }
    return `请输入 ${label}`;
  };

  const renderControl = (type: ParamUIType) => {
    switch (type) {
      case 'select':
        return renderSelect();
      case 'radio':
        return renderRadio();
      case 'switch':
        return renderSwitch();
      case 'input-number':
        return renderInputNumber();
      case 'slider':
        return renderSlider();
      case 'textarea':
        return renderTextarea();
      case 'tags':
        return renderTags();
      case 'password':
        return renderPassword();
      case 'input':
      default:
        return renderInput();
    }
  };

  if (uiType === 'switch') {
    return (
      <Form.Item
        name={fieldPath}
        label={labelNode}
        rules={rules}
        help={helpText}
        valuePropName="checked"
        initialValue={definition.default ?? false}
      >
        {renderSwitch()}
      </Form.Item>
    );
  }

  return (
    <Form.Item
      name={fieldPath}
      label={labelNode}
      rules={rules}
      help={helpText}
      initialValue={definition.default}
    >
      {renderControl(uiType)}
    </Form.Item>
  );
};

export default ParamField;
