import { Breadcrumb, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  title: string;
  path?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** 标题块左侧（如详情/表单页「返回」） */
  prefix?: ReactNode;
  /**
   * 标题列右侧的主操作区（如「创建」），与 {@link extra} 形成「左：标题 + 主操作 / 右：筛选与查询」。
   */
  leftExtra?: ReactNode;
  /** 右侧：筛选控件、查询（建议 `type="primary"`）、重置/刷新（建议 `default` + icon） */
  extra?: ReactNode;
}

/**
 * 管理后台统一页头：可选面包屑 + 单行工具栏。
 *
 * **布局**：`justify-content: space-between`，左侧为标题（及副标题）与 `leftExtra`，右侧为 `extra`。
 *
 * **按钮约定**（与 Ant Design 一致即可）：
 * - 主路径：`type="primary"` — 创建、查询、确定
 * - 次要：`default` + `icon` — 刷新、重置、返回
 */
export default function PageHeader({ title, subtitle, breadcrumbs, prefix, leftExtra, extra }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb
          style={{ marginBottom: 8 }}
          items={breadcrumbs.map((b) => ({
            title: b.path ? <Link to={b.path}>{b.title}</Link> : b.title,
          }))}
        />
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            minWidth: 0,
          }}
        >
          {prefix ? <Space wrap>{prefix}</Space> : null}
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            {subtitle && (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                {subtitle}
              </Typography.Text>
            )}
          </div>
          {leftExtra ? <Space wrap>{leftExtra}</Space> : null}
        </div>
        {extra ? <Space wrap>{extra}</Space> : null}
      </div>
    </div>
  );
}
