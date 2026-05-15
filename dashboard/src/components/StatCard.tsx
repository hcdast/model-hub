import { Card, Statistic, theme } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

interface Props {
  title: string;
  value: number | string;
  prefix?: ReactNode;
  suffix?: string;
  precision?: number;
  valueStyle?: CSSProperties;
}

export default function StatCard({ title, value, prefix, suffix, precision, valueStyle }: Props) {
  const { token } = theme.useToken();

  return (
    <Card
      hoverable
      size="small"
      styles={{ body: { paddingBlock: token.paddingSM } }}
      style={{
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadowTertiary,
      }}
    >
      <Statistic
        title={title}
        value={value}
        prefix={prefix}
        suffix={suffix}
        precision={precision}
        valueStyle={valueStyle}
      />
    </Card>
  );
}
