import { useEffect, useState, useCallback } from 'react';
import {
  Table, Card, Button, Space, Tag, Switch, message, Modal, Form, Input, Select,
  Typography, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { userApi, roleApi } from '../services/api';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchUsername, setSearchUsername] = useState('');

  // roles for select options
  const [roles, setRoles] = useState<any[]>([]);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm] = Form.useForm();

  const fetchRoles = useCallback(async () => {
    try {
      const res: any = await roleApi.list();
      setRoles(res.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchUsers = useCallback(async (p = page, ps = pageSize, username = searchUsername) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p, pageSize: ps };
      if (username) params.username = username;
      const res: any = await userApi.list(params);
      setUsers(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch {
      message.error('加载用户列表失败');
    }
    setLoading(false);
  }, [page, pageSize, searchUsername]);

  useEffect(() => {
    fetchUsers(1, pageSize, '');
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- handlers ----

  const handleSearch = () => {
    fetchUsers(1, pageSize, searchUsername);
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      await userApi.create(values);
      message.success('用户创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers(1, pageSize, searchUsername);
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建用户失败');
    }
    setCreating(false);
  };

  const handleEdit = async () => {
    const values = await editForm.validateFields().catch(() => null);
    if (!values || !editingUser) return;
    setEditing(true);
    try {
      await userApi.update(editingUser._id, values);
      message.success('用户更新成功');
      setEditOpen(false);
      setEditingUser(null);
      editForm.resetFields();
      fetchUsers(page, pageSize, searchUsername);
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新用户失败');
    }
    setEditing(false);
  };

  const openEdit = (record: any) => {
    setEditingUser(record);
    editForm.setFieldsValue({
      displayName: record.displayName || '',
      email: record.email || '',
      roles: record.roles || [],
    });
    setEditOpen(true);
  };

  const handleToggleStatus = async (record: any, enabled: boolean) => {
    try {
      await userApi.toggleStatus(record._id, enabled);
      message.success(enabled ? '已启用' : '已禁用');
      fetchUsers(page, pageSize, searchUsername);
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  const handleDelete = async (record: any) => {
    try {
      await userApi.delete(record._id);
      message.success('用户已删除');
      fetchUsers(page, pageSize, searchUsername);
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const handleResetPassword = async (record: any) => {
    try {
      const res: any = await userApi.resetPassword(record._id);
      const tempPassword = res.data?.temporaryPassword || res.data?.password || '';
      Modal.success({
        title: '密码已重置',
        width: 480,
        content: (
          <div>
            <Typography.Paragraph>
              用户 <strong>{record.username}</strong> 的临时密码：
            </Typography.Paragraph>
            <Typography.Paragraph copyable={{ text: tempPassword }}>
              <code>{tempPassword}</code>
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              请将临时密码告知用户，用户首次登录后需修改密码。
            </Typography.Text>
          </div>
        ),
      });
    } catch (err: any) {
      message.error(err.response?.data?.message || '重置密码失败');
    }
  };

  // ---- columns ----

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 160,
    },
    {
      title: '显示名称',
      dataIndex: 'displayName',
      key: 'displayName',
      width: 160,
      render: (v: string) => v || '-',
    },
    {
      title: '角色',
      dataIndex: 'roles',
      key: 'roles',
      width: 220,
      render: (roles: string[]) =>
        roles?.length
          ? roles.map((r) => <Tag key={r} color="blue">{r}</Tag>)
          : <Tag>无角色</Tag>,
    },
    {
      title: '状态',
      key: 'enabled',
      width: 100,
      render: (_: unknown, r: any) => (
        <Switch
          checked={r.enabled !== false}
          onChange={(v) => handleToggleStatus(r, v)}
          size="small"
        />
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 180,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_: unknown, r: any) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => handleResetPassword(r)}>
            重置密码
          </Button>
          <Popconfirm
            title="确认删除该用户？"
            description="删除后用户将无法登录系统"
            onConfirm={() => handleDelete(r)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ---- render ----

  const roleOptions = roles.map((r: any) => ({
    label: r.displayName || r.name,
    value: r.name,
  }));

  return (
    <Card
      title="用户管理"
      extra={
        <Space>
          <Input
            placeholder="搜索用户名"
            prefix={<SearchOutlined />}
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            style={{ width: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchUsers(page, pageSize, searchUsername)}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建用户
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="_id"
        columns={columns}
        dataSource={users}
        loading={loading}
        size="small"
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => fetchUsers(p, ps || pageSize, searchUsername),
        }}
      />

      {/* 新建用户弹窗 */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少8个字符' },
            ]}
          >
            <Input.Password placeholder="至少8个字符，包含大小写字母和数字" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="请输入显示名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="roles"
            label="角色"
            rules={[{ required: true, message: '请选择至少一个角色' }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择角色"
              options={roleOptions}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户弹窗 */}
      <Modal
        title={`编辑用户 - ${editingUser?.username || ''}`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditingUser(null); editForm.resetFields(); }}
        onOk={handleEdit}
        confirmLoading={editing}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="请输入显示名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="roles"
            label="角色"
            rules={[{ required: true, message: '请选择至少一个角色' }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择角色"
              options={roleOptions}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
