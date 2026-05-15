import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Card, Button, Space, Tag, message, Modal, Form, Input, InputNumber,
  Switch, Select, Popconfirm, TreeSelect,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { menuAdminApi, permissionApi } from '../services/api';
import PageHeader from '../components/PageHeader';

interface MenuTreeNode {
  key: string;
  label: string;
  path?: string;
  icon: string;
  sortOrder: number;
  parentKey?: string;
  requiredPermission?: string;
  associatedPermissions: string[];
  enabled: boolean;
  moduleKey?: string;
  children: MenuTreeNode[];
}

/** 侧栏分组 parentKey → 中文名（与后端 DEFAULT_GROUPS 一致） */
const MENU_GROUP_PARENT_LABELS: Record<string, string> = {
  overview: '仪表盘',
  business: '业务接入',
  'model-routing': '模型路由',
  billing: '计费与成本',
  provider: '供应商管理',
  notification: '通知中心',
  system: '系统设置',
  access: '访问控制',
  audit: '审计与日志',
};

interface Permission {
  code: string;
  resource: string;
  action: string;
  displayName: string;
  module: string;
}

export default function MenusPage() {
  const [menus, setMenus] = useState<MenuTreeNode[]>([]);
  const [flatMenus, setFlatMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingMenu, setEditingMenu] = useState<any>(null);
  const [editForm] = Form.useForm();

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const [treeRes, flatRes]: any[] = await Promise.all([
        menuAdminApi.getTree(),
        menuAdminApi.listFlat(),
      ]);
      setMenus(treeRes.data || []);
      setFlatMenus(flatRes.data || []);
    } catch {
      message.error('加载菜单列表失败');
    }
    setLoading(false);
  }, []);

  const fetchPermissions = useCallback(async () => {
    try {
      const res: any = await permissionApi.list();
      setPermissions(res.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchMenus();
    fetchPermissions();
  }, []);

  // ---- handlers ----

  const handleCreate = async () => {
    const values = await createForm.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      await menuAdminApi.create({
        ...values,
        associatedPermissions: values.associatedPermissions || [],
      });
      message.success('菜单创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchMenus();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建菜单失败');
    }
    setCreating(false);
  };

  const handleEdit = async () => {
    const values = await editForm.validateFields().catch(() => null);
    if (!values || !editingMenu) return;
    setEditing(true);
    try {
      await menuAdminApi.update(editingMenu.key, {
        ...values,
        associatedPermissions: values.associatedPermissions || [],
      });
      message.success('菜单更新成功');
      setEditOpen(false);
      setEditingMenu(null);
      editForm.resetFields();
      fetchMenus();
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新菜单失败');
    }
    setEditing(false);
  };

  const openEdit = (record: any) => {
    setEditingMenu(record);
    editForm.setFieldsValue({
      label: record.label || '',
      path: record.path || '',
      icon: record.icon || '',
      sortOrder: record.sortOrder ?? 0,
      parentKey: record.parentKey || undefined,
      requiredPermission: record.requiredPermission || '',
      associatedPermissions: record.associatedPermissions || [],
      enabled: record.enabled !== false,
      moduleKey: record.moduleKey || '',
    });
    setEditOpen(true);
  };

  const handleDelete = async (record: any) => {
    try {
      await menuAdminApi.delete(record.key);
      message.success('菜单已删除');
      fetchMenus();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除菜单失败');
    }
  };

  // parent menu: 侧栏分组 + 菜单树（与后端 parentKey 语义一致）
  const parentTreeSelectData = useMemo(() => {
    const groupNodes = Object.entries(MENU_GROUP_PARENT_LABELS).map(([value, label]) => ({
      value,
      title: `${label}（分组）`,
    }));
    const menuNodes = (function mapNodes(nodes: MenuTreeNode[]): any[] {
      return nodes
        .filter((n) => n.key !== editingMenu?.key)
        .map((n) => ({
          value: n.key,
          title: `${n.label} (${n.key})`,
          children: n.children?.length ? mapNodes(n.children) : undefined,
        }));
    })(menus);
    return [
      {
        value: '__sidebar_groups__',
        title: '侧栏分组',
        selectable: false,
        children: groupNodes,
      },
      {
        value: '__menu_items__',
        title: '挂载到菜单项下',
        selectable: false,
        children: menuNodes.length > 0 ? menuNodes : undefined,
      },
    ];
  }, [menus, editingMenu?.key]);

  const keyToLabel = useMemo(() => {
    const m = new Map<string, string>();
    (flatMenus as { key: string; label: string }[]).forEach((row) => {
      m.set(row.key, row.label);
    });
    return m;
  }, [flatMenus]);

  const parentLabelFor = useCallback(
    (parentKey?: string) => {
      if (!parentKey) return '—';
      return keyToLabel.get(parentKey) || MENU_GROUP_PARENT_LABELS[parentKey] || parentKey;
    },
    [keyToLabel],
  );

  // permission options for associatedPermissions
  const permissionOptions = permissions.map((p) => ({
    label: `${p.displayName || p.code}`,
    value: p.code,
  }));

  // ---- table columns ----

  const columns = [
    {
      title: '菜单名称',
      dataIndex: 'label',
      key: 'label',
      width: 220,
      ellipsis: true,
    },
    {
      title: '父级',
      dataIndex: 'parentKey',
      key: 'parentKey',
      width: 200,
      ellipsis: true,
      render: (pk: string | undefined) => (
        <Tag color={pk && MENU_GROUP_PARENT_LABELS[pk] ? 'purple' : 'default'}>
          {parentLabelFor(pk)}
        </Tag>
      ),
    },
    {
      title: '路由路径',
      dataIndex: 'path',
      key: 'path',
      width: 200,
      render: (v: string) => v || '-',
    },
    {
      title: '图标',
      dataIndex: 'icon',
      key: 'icon',
      width: 150,
    },
    {
      title: '所需权限',
      dataIndex: 'requiredPermission',
      key: 'requiredPermission',
      width: 150,
      render: (v: string) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: '关联权限数',
      key: 'assocPermCount',
      width: 110,
      render: (_: unknown, r: any) => (
        <Tag color="blue">{r.associatedPermissions?.length ?? 0}</Tag>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 80,
    },
    {
      title: '状态',
      key: 'enabled',
      width: 80,
      render: (_: unknown, r: any) => (
        r.enabled !== false
          ? <Tag color="green">启用</Tag>
          : <Tag color="red">禁用</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, r: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该菜单？"
            description="有子菜单时无法删除"
            onConfirm={() => handleDelete(r)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];


  return (
    <div>
      <PageHeader
        title="菜单管理"
        leftExtra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建菜单
          </Button>
        )}
        extra={<Button icon={<ReloadOutlined />} onClick={fetchMenus}>刷新</Button>}
      />
      <Card>
        <Table
          rowKey="key"
          columns={columns}
          dataSource={menus}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: 1280 }}
          defaultExpandAllRows
          childrenColumnName="children"
        />

        {/* 新建菜单弹窗 */}
        <Modal
          title="新建菜单"
          open={createOpen}
          onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
          onOk={handleCreate}
          confirmLoading={creating}
          destroyOnClose
          width={640}
        >
          <Form form={createForm} layout="vertical" initialValues={{ enabled: true, sortOrder: 0 }}>
            <Form.Item
              name="key"
              label="菜单标识"
              rules={[{ required: true, message: '请输入菜单标识' }]}
            >
              <Input placeholder="唯一标识，如 tasks（kebab-case）" maxLength={50} />
            </Form.Item>
            <Form.Item
              name="label"
              label="显示名称"
              rules={[{ required: true, message: '请输入显示名称' }]}
            >
              <Input placeholder="如：用量账单" maxLength={100} />
            </Form.Item>
            <Form.Item name="path" label="路由路径">
              <Input placeholder="如：/tasks" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="icon"
              label="图标名称"
              rules={[{ required: true, message: '请输入图标名称' }]}
            >
              <Input placeholder="Ant Design 图标名，如 FileTextOutlined" maxLength={100} />
            </Form.Item>
            <Form.Item name="parentKey" label="父级菜单">
              <TreeSelect
                allowClear
                showSearch
                treeDefaultExpandAll
                treeLine={{ showLeafIcon: false }}
                placeholder="选择侧栏分组或上级菜单项"
                treeData={parentTreeSelectData}
                filterTreeNode={(input, node) =>
                  String(node?.title ?? '').toLowerCase().includes(input.toLowerCase())}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序权重">
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="requiredPermission" label="所需权限">
              <Select
                allowClear
                showSearch
                placeholder="选择该菜单所需权限"
                options={permissionOptions}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="associatedPermissions" label="关联权限">
              <Select
                mode="multiple"
                allowClear
                placeholder="选择关联权限（用于角色管理中的快捷填充）"
                options={permissionOptions}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="moduleKey" label="模块标识">
              <Input placeholder="关联的功能模块 key" maxLength={50} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Modal>

        {/* 编辑菜单弹窗 */}
        <Modal
          title={`编辑菜单 - ${editingMenu?.label || ''}`}
          open={editOpen}
          onCancel={() => { setEditOpen(false); setEditingMenu(null); editForm.resetFields(); }}
          onOk={handleEdit}
          confirmLoading={editing}
          destroyOnClose
          width={640}
        >
          <Form form={editForm} layout="vertical">
            <Form.Item label="菜单标识">
              <Input value={editingMenu?.key} disabled />
            </Form.Item>
            <Form.Item
              name="label"
              label="显示名称"
              rules={[{ required: true, message: '请输入显示名称' }]}
            >
              <Input placeholder="如：用量账单" maxLength={100} />
            </Form.Item>
            <Form.Item name="path" label="路由路径">
              <Input placeholder="如：/tasks" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="icon"
              label="图标名称"
              rules={[{ required: true, message: '请输入图标名称' }]}
            >
              <Input placeholder="Ant Design 图标名" maxLength={100} />
            </Form.Item>
            <Form.Item name="parentKey" label="父级菜单">
              <TreeSelect
                allowClear
                showSearch
                treeDefaultExpandAll
                treeLine={{ showLeafIcon: false }}
                placeholder="选择侧栏分组或上级菜单项"
                treeData={parentTreeSelectData}
                filterTreeNode={(input, node) =>
                  String(node?.title ?? '').toLowerCase().includes(input.toLowerCase())}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序权重">
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="requiredPermission" label="所需权限">
              <Select
                allowClear
                showSearch
                placeholder="选择该菜单所需权限"
                options={permissionOptions}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="associatedPermissions" label="关联权限">
              <Select
                mode="multiple"
                allowClear
                placeholder="选择关联权限"
                options={permissionOptions}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="moduleKey" label="模块标识">
              <Input placeholder="关联的功能模块 key" maxLength={50} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
}
