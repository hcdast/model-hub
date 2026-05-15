/**
 * 参数表单容器组件
 * 根据参数定义自动渲染完整的参数配置表单
 */

import React, { useEffect, useImperativeHandle, forwardRef } from 'react';
import { Form, Divider, Typography, Collapse, Empty } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { ParamFormProps, ParamFormInstance, ParamDefinitions } from './types';
import { ParamField } from './ParamField';
import { filterHiddenParams, groupParams, getInitialValues } from './utils';

const { Title, Text } = Typography;

/**
 * 参数表单组件
 */
export const ParamForm = forwardRef<ParamFormInstance, ParamFormProps>(
  (
    {
      definitions,
      value,
      onChange,
      disabled = false,
      layout = 'vertical',
    },
    ref
  ) => {
    const [form] = Form.useForm();

    // 过滤隐藏参数
    const visibleParams = filterHiddenParams(definitions);

    // 分组参数
    const [requiredParams, optionalParams] = groupParams(visibleParams);

    // 暴露表单方法
    useImperativeHandle(ref, () => ({
      getValues: () => {
        const formValues = form.getFieldsValue();
        return formValues.params || {};
      },
      validateFields: async () => {
        await form.validateFields();
        const formValues = form.getFieldsValue();
        return formValues.params || {};
      },
      setValues: (values: Record<string, any>) => {
        form.setFieldsValue({ params: values });
      },
      resetFields: () => {
        form.resetFields();
      },
    }));

    // 初始化默认值
    useEffect(() => {
      const initialValues = getInitialValues(definitions);
      form.setFieldsValue({ params: initialValues });
    }, [definitions, form]);

    // 受控模式：外部值变化时更新表单
    useEffect(() => {
      if (value) {
        form.setFieldsValue({ params: value });
      }
    }, [value, form]);

    // 表单值变化回调
    const handleValuesChange = (_: any, allValues: any) => {
      if (onChange) {
        onChange(allValues.params || {});
      }
    };

    // 如果没有参数定义，显示空状态
    if (requiredParams.length === 0 && optionalParams.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无参数配置"
        />
      );
    }

    return (
      <Form
        form={form}
        layout={layout}
        onValuesChange={handleValuesChange}
        disabled={disabled}
        initialValues={{ params: getInitialValues(definitions) }}
      >
        {/* 必填参数 */}
        {requiredParams.length > 0 && (
          <>
            <Title level={5} style={{ marginBottom: 16 }}>
              <SettingOutlined style={{ marginRight: 8 }} />
              基础参数
            </Title>
            {requiredParams.map(paramName => (
              <ParamField
                key={paramName}
                name={paramName}
                definition={definitions[paramName]}
                disabled={disabled}
              />
            ))}
          </>
        )}

        {/* 可选参数 */}
        {optionalParams.length > 0 && (
          <>
            {requiredParams.length > 0 && <Divider />}
            <Collapse
              ghost
              defaultActiveKey={optionalParams.length <= 5 ? ['optional'] : []}
            >
              <Collapse.Panel
                header={
                  <Title level={5} style={{ margin: 0 }}>
                    高级参数（可选）
                  </Title>
                }
                key="optional"
              >
                {optionalParams.map(paramName => (
                  <ParamField
                    key={paramName}
                    name={paramName}
                    definition={definitions[paramName]}
                    disabled={disabled}
                  />
                ))}
              </Collapse.Panel>
            </Collapse>
          </>
        )}
      </Form>
    );
  }
);

ParamForm.displayName = 'ParamForm';

export default ParamForm;
