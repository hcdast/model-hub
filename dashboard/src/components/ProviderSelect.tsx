import { Select } from 'antd';
import type { SelectProps } from 'antd';
import { useProviderOptions } from '../hooks/useProviderOptions';

export interface ProviderSelectProps extends Omit<SelectProps, 'options'> {
  /** 额外选项（如当前值尚未出现在供应商配置中） */
  extraValues?: string[];
}

/** 厂商下拉：数据与「供应商配置」列表一致 */
export default function ProviderSelect({ extraValues, placeholder, ...rest }: ProviderSelectProps) {
  const { options, loading } = useProviderOptions(extraValues);

  return (
    <Select
      placeholder={placeholder ?? '请选择厂商'}
      showSearch
      allowClear
      optionFilterProp="label"
      loading={loading}
      options={options}
      {...rest}
    />
  );
}
