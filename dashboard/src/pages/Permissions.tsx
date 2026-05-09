import { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Card, Select, message, Tag, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { permissionApi } from '../services/api';
import PageHeader from '../components/PageHeader';

interface Permission {
  code: string;
  resource: string;
  action: string;
  displayName: string;
  module: string;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedModule, setSelectedModule] = useState<string | undefined>(undefined);

  const fetchPermissions = useCallback(async (module?: string) => {
    setLoading(true);
    try {
      const params = module ? { module } : undefined;
      const res: any = await permissionApi.list(params);
      setPermissions(res.data || []);
    } catch {
      message.error('加载权限列表失败');
    }
    setLoading(false);
  }, []);

  const fetchModules = useCallback(async () => {
    try {
      const res: any = await permissionApi.listModules();
      setModules(res.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
    fetchModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModuleChange = (value: string | undefined) => {
    setSelectedModule(value);
    fetchPermissions(value);
  };

  // Group permissions by module for display
  const groupedData = useMemo(() => {
    const groups: Record<string, Permission[]> = {};
    permissions.forEach((p) => {
      const mod = p.module || '未分类';
      if (!groups[mod]) groups[mod] = [];
      groups[mod].push(p);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([mod, perms]) =>
        perms.map((p, i) => ({ ...p, _module: mod, _first: i === 0, _span: perms.length })),
      );
  }, [permissions]);

  const columns = [
    {
      title: '所属模块',
      dataIndex: 'module',
      key: 'module',
      width: 160,
      render: (_: string, record: any) => {
        if (!record._first) return { children: null, props: { rowSpan: 0 } };
        return { children: <Tag color="blue">{record._module}</Tag>, props: { rowSpan: record._span } };
      },
    },
    {
      title: '权限代码',
      dataIndex: 'code',
      key: 'code',
      width: 200,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: '资源类型',
      dataIndex: 'resource',
      key: 'resource',
      width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (v: string) => {
        const colorMap: Record<string, string> = {
          read: 'green', create: 'blue', update: 'orange', delete: 'red', execute: 'purple',
        };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '显示名称',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (v: string) => v || '-',
    },
  ];

  return (
    <div>
      <PageHeader
        title="权限管理"
        extra={(
          <>
            <Select
              allowClear
              placeholder="按模块过滤"
              style={{ width: 200 }}
              value={selectedModule}
              onChange={handleModuleChange}
              options={modules.map((m) => ({ label: m, value: m }))}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchPermissions(selectedModule)}
            >
              刷新
            </Button>
          </>
        )}
      />
      <Card>
        <Table
          rowKey="code"
          columns={columns}
          dataSource={groupedData}
          loading={loading}
          size="small"
          pagination={false}
        />
      </Card>
    </div>
  );
}
