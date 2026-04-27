import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Card, Button, Space, Tag, message, Modal, Form, Input, Collapse,
  Checkbox, Badge, Popconfirm, Tooltip,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, LockOutlined,
} from '@ant-design/icons';
import { roleApi, permissionApi } from '../services/api';

interface Permission {
  code: string;
  resource: string;
  action: string;
  displayName: string;
  module: string;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // all permissions for checkbox selection
  const [permissions, setPermissions] = useState<Permission[]>([]);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const [createSelectedPerms, setCreateSelectedPerms] = useState<string[]>([]);

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [editForm] = Form.useForm();
  const [editSelectedPerms, setEditSelectedPerms] = useState<string[]>([]);

  // group permissions by module
  const groupedPermissions = useMemo(() => {
    const groups: Record<string, Permission[]> = {};
    permissions.forEach((p) => {
      if (!groups[p.module]) groups[p.module] = [];
      groups[p.module].push(p);
    });
    return groups;
  }, [permissions]);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await roleApi.list();
      setRoles(res.data || []);
    } catch {
      message.error('加载角色列表失败');
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
    fetchRoles();
    fetchPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- handlers ----

  const handleCreate = async () => {
    const values = await createForm.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      await roleApi.create({
        name: values.name,
        displayName: values.displayName,
        description: values.description,
        permissions: createSelectedPerms,
      });
      message.success('角色创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      setCreateSelectedPerms([]);
      fetchRoles();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建角色失败');
    }
    setCreating(false);
  };

  const handleEdit = async () => {
    const values = await editForm.validateFields().catch(() => null);
    if (!values || !editingRole) return;
    setEditing(true);
    try {
      await roleApi.update(editingRole.name, {
        displayName: values.displayName,
        description: values.description,
        permissions: editSelectedPerms,
      });
      message.success('角色更新成功');
      setEditOpen(false);
      setEditingRole(null);
      editForm.resetFields();
      setEditSelectedPerms([]);
      fetchRoles();
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新角色失败');
    }
    setEditing(false);
  };

  const openEdit = (record: any) => {
    setEditingRole(record);
    editForm.setFieldsValue({
      displayName: record.displayName || '',
      description: record.description || '',
    });
    setEditSelectedPerms(record.permissions || []);
    setEditOpen(true);
  };

  const handleDelete = async (record: any) => {
    try {
      // check if role is in use first
      const res: any = await roleApi.checkInUse(record.name);
      if (res.data?.inUse) {
        message.error('该角色正在被用户使用，无法删除');
        return;
      }
      await roleApi.delete(record.name);
      message.success('角色已删除');
      fetchRoles();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除角色失败');
    }
  };

  // ---- permission checkbox helpers ----

  const renderPermissionCheckboxes = (
    selected: string[],
    onChange: (perms: string[]) => void,
  ) => {
    const modules = Object.keys(groupedPermissions).sort();
    if (modules.length === 0) {
      return <div style={{ color: '#999', padding: 8 }}>暂无权限定义</div>;
    }

    return (
      <Collapse
        size="small"
        items={modules.map((mod) => {
          const perms = groupedPermissions[mod];
          const allCodes = perms.map((p) => p.code);
          const checkedCodes = allCodes.filter((c) => selected.includes(c));
          const allChecked = checkedCodes.length === allCodes.length;
          const indeterminate = checkedCodes.length > 0 && !allChecked;

          return {
            key: mod,
            label: (
              <Checkbox
                indeterminate={indeterminate}
                checked={allChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const otherPerms = selected.filter((c) => !allCodes.includes(c));
                  onChange(e.target.checked ? [...otherPerms, ...allCodes] : otherPerms);
                }}
              >
                {mod} ({checkedCodes.length}/{allCodes.length})
              </Checkbox>
            ),
            children: (
              <Checkbox.Group
                value={checkedCodes}
                onChange={(vals) => {
                  const otherPerms = selected.filter((c) => !allCodes.includes(c));
                  onChange([...otherPerms, ...(vals as string[])]);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}
              >
                {perms.map((p) => (
                  <Checkbox key={p.code} value={p.code}>
                    {p.displayName || p.code}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            ),
          };
        })}
      />
    );
  };

  // ---- columns ----

  const columns = [
    {
      title: '角色名',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (v: string, r: any) => (
        <Space>
          {v}
          {r.isSystem && <Tag color="gold">系统</Tag>}
        </Space>
      ),
    },
    {
      title: '显示名称',
      dataIndex: 'displayName',
      key: 'displayName',
      width: 160,
      render: (v: string) => v || '-',
    },
    {
      title: '权限数量',
      key: 'permissionCount',
      width: 120,
      render: (_: unknown, r: any) => (
        <Badge count={r.permissions?.length ?? 0} showZero color="#1677ff" overflowCount={999} />
      ),
    },
    {
      title: '状态',
      key: 'enabled',
      width: 100,
      render: (_: unknown, r: any) => (
        r.enabled !== false
          ? <Tag color="green">启用</Tag>
          : <Tag color="red">禁用</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, r: any) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          {r.isSystem ? (
            <Tooltip title="系统角色不可删除">
              <Button type="link" size="small" danger disabled>
                <LockOutlined /> 删除
              </Button>
            </Tooltip>
          ) : (
            <Popconfirm
              title="确认删除该角色？"
              description="删除后该角色将不可恢复"
              onConfirm={() => handleDelete(r)}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ---- render ----

  return (
    <Card
      title="角色管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchRoles}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建角色
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="name"
        columns={columns}
        dataSource={roles}
        loading={loading}
        size="small"
        pagination={false}
      />

      {/* 新建角色弹窗 */}
      <Modal
        title="新建角色"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); setCreateSelectedPerms([]); }}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnClose
        width={640}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="角色名"
            rules={[{ required: true, message: '请输入角色名' }]}
          >
            <Input placeholder="请输入角色名（英文）" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="请输入显示名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入角色描述" rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item label="权限">
            {renderPermissionCheckboxes(createSelectedPerms, setCreateSelectedPerms)}
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑角色弹窗 */}
      <Modal
        title={`编辑角色 - ${editingRole?.displayName || editingRole?.name || ''}`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditingRole(null); editForm.resetFields(); setEditSelectedPerms([]); }}
        onOk={handleEdit}
        confirmLoading={editing}
        destroyOnClose
        width={640}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="displayName"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="请输入显示名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入角色描述" rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item label="权限">
            {renderPermissionCheckboxes(editSelectedPerms, setEditSelectedPerms)}
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
