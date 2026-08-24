import { useEffect, useState, useCallback } from 'react';
import {
  Table, Card, Button, Space, Tag, Switch, message, Modal, Form, Input, Select,
  Typography, Popconfirm, Statistic, Row, Col, Descriptions, Badge, Tooltip,
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, UserOutlined, DeleteOutlined,
  KeyOutlined, EyeOutlined, CopyOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import dayjs from 'dayjs';
import { portalUserApi } from '../services/api';

const { Text } = Typography;

export default function PortalUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');

  // 统计数据
  const [stats, setStats] = useState<any>(null);

  // 编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm] = Form.useForm();

  // 用户详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState<any>(null);

  // 获取用户列表
  const fetchUsers = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page: p,
        pageSize: ps,
      };
      if (keyword) params.keyword = keyword;
      if (statusFilter) params.status = statusFilter;
      if (roleFilter) params.role = roleFilter;

      const res: any = await portalUserApi.list(params);
      if (res.code === 0) {
        setUsers(res.data.items || []);
        setTotal(res.data.total || 0);
      } else {
        message.error(res.message || 'Failed to fetch users');
      }
    } catch (err) {
      message.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter, roleFilter]);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      const res: any = await portalUserApi.getStats();
      if (res.code === 0) {
        setStats(res.data);
      }
    } catch (err) {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchStats();
  }, [fetchUsers, fetchStats]);

  // 获取用户详情
  const handleViewDetail = async (userId: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res: any = await portalUserApi.get(userId);
      if (res.code === 0) {
        setUserDetail(res.data);
      } else {
        message.error(res.message || 'Failed to fetch user detail');
      }
    } catch (err) {
      message.error('Failed to fetch user detail');
    } finally {
      setDetailLoading(false);
    }
  };

  // 切换用户状态
  const handleToggleStatus = async (userId: string) => {
    try {
      const res: any = await portalUserApi.toggleStatus(userId);
      if (res.code === 0) {
        message.success(res.message);
        fetchUsers();
        fetchStats();
      } else {
        message.error(res.message || 'Failed to update status');
      }
    } catch (err) {
      message.error('Failed to update status');
    }
  };

  // 删除用户
  const handleDelete = async (userId: string) => {
    try {
      const res: any = await portalUserApi.delete(userId);
      if (res.code === 0) {
        message.success('User deleted');
        fetchUsers();
        fetchStats();
      } else {
        message.error(res.message || 'Failed to delete user');
      }
    } catch (err) {
      message.error('Failed to delete user');
    }
  };

  // 打开编辑弹窗
  const handleEdit = (user: any) => {
    setEditingUser(user);
    editForm.setFieldsValue({
      username: user.username,
      role: user.role,
      status: user.status,
    });
    setEditOpen(true);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields();
      setEditing(true);

      const res: any = await portalUserApi.update(editingUser._id, values);
      if (res.code === 0) {
        message.success('User updated');
        setEditOpen(false);
        fetchUsers();
      } else {
        message.error(res.message || 'Failed to update user');
      }
    } catch (err) {
      // validation error or network error
    } finally {
      setEditing(false);
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => (
        <Text copyable style={{ color: '#1890ff' }}>{email}</Text>
      ),
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const colorMap: Record<string, string> = {
          user: 'default',
          admin: 'red',
          vip: 'gold',
        };
        return <Tag color={colorMap[role] || 'default'}>{role.toUpperCase()}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string, record: any) => (
        <Switch
          checked={status === 'active'}
          checkedChildren="正常"
          unCheckedChildren="禁用"
          onChange={() => handleToggleStatus(record._id)}
        />
      ),
    },
    {
      title: 'API Keys',
      key: 'apiKeyCount',
      width: 100,
      render: (_: any, record: any) => (
        <Button
          type="link"
          icon={<KeyOutlined />}
          onClick={() => handleViewDetail(record._id)}
        >
          查看
        </Button>
      ),
    },
    {
      title: '工作流数',
      dataIndex: ['usage', 'totalWorkflows'],
      key: 'totalWorkflows',
      render: (val: number) => val || 0,
    },
    {
      title: '运行次数',
      dataIndex: ['usage', 'totalRuns'],
      key: 'totalRuns',
      render: (val: number) => val || 0,
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record._id)}>
            详情
          </Button>
          <Button size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除此用户？"
            description="删除后将禁用该用户的所有 API Key"
            onConfirm={() => handleDelete(record._id)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Portal 用户管理" subtitle="管理开发者门户的注册用户" />

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="总用户数" value={stats.totalUsers} prefix={<UserOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="活跃用户" value={stats.activeUsers} valueStyle={{ color: '#3f8600' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="已禁用" value={stats.suspendedUsers} valueStyle={{ color: '#cf1322' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="今日新增" value={stats.newUsersToday} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="本周新增" value={stats.newUsersThisWeek} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="本月新增" value={stats.newUsersThisMonth} />
            </Card>
          </Col>
        </Row>
      )}

      <Card>
        {/* 筛选栏 */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
          <Input
            placeholder="搜索邮箱/用户名"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => fetchUsers(1)}
            style={{ width: 250 }}
            allowClear
          />
          <Select
            placeholder="状态筛选"
            value={statusFilter || undefined}
            onChange={(val) => setStatusFilter(val || '')}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: '正常', value: 'active' },
              { label: '禁用', value: 'suspended' },
            ]}
          />
          <Select
            placeholder="角色筛选"
            value={roleFilter || undefined}
            onChange={(val) => setRoleFilter(val || '')}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: '普通用户', value: 'user' },
              { label: 'VIP', value: 'vip' },
              { label: '管理员', value: 'admin' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchUsers()}>
            刷新
          </Button>
        </div>

        {/* 用户表格 */}
        <Table
          columns={columns}
          dataSource={users}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* 用户详情弹窗 */}
      <Modal
        title="用户详情"
        open={detailOpen}
        onCancel={() => {
          setDetailOpen(false);
          setUserDetail(null);
        }}
        footer={null}
        width={700}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
        ) : userDetail ? (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="用户 ID">{userDetail._id}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{userDetail.email}</Descriptions.Item>
              <Descriptions.Item label="用户名">{userDetail.username}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={userDetail.role === 'admin' ? 'red' : userDetail.role === 'vip' ? 'gold' : 'default'}>
                  {userDetail.role?.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={userDetail.status === 'active' ? 'success' : 'error'} text={userDetail.status === 'active' ? '正常' : '禁用'} />
              </Descriptions.Item>
              <Descriptions.Item label="注册时间">
                {dayjs(userDetail.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="最后登录">
                {userDetail.lastLoginAt ? dayjs(userDetail.lastLoginAt).format('YYYY-MM-DD HH:mm:ss') : '从未登录'}
              </Descriptions.Item>
              <Descriptions.Item label="登录 IP">
                {userDetail.lastLoginIp || '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* API Key 列表 */}
            <div style={{ marginTop: 24 }}>
              <h4 style={{ marginBottom: 12 }}>
                <KeyOutlined /> API Keys ({userDetail.apiKeys?.length || 0})
              </h4>
              {userDetail.apiKeys && userDetail.apiKeys.length > 0 ? (
                <Table
                  dataSource={userDetail.apiKeys}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    {
                      title: '名称',
                      dataIndex: 'name',
                      key: 'name',
                      width: 120,
                    },
                    {
                      title: 'API Key',
                      dataIndex: 'apiKey',
                      key: 'apiKey',
                      render: (key: string) => (
                        <Space>
                          <Text
                            copyable={{ text: key, icon: <CopyOutlined /> }}
                            style={{ fontSize: 11, fontFamily: 'monospace' }}
                          >
                            {key}
                          </Text>
                        </Space>
                      ),
                    },
                    {
                      title: '状态',
                      dataIndex: 'enabled',
                      key: 'enabled',
                      width: 80,
                      render: (enabled: boolean) => (
                        <Tag color={enabled ? 'green' : 'red'}>
                          {enabled ? '启用' : '禁用'}
                        </Tag>
                      ),
                    },
                    {
                      title: '最后使用',
                      dataIndex: 'lastUsedAt',
                      key: 'lastUsedAt',
                      width: 150,
                      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '从未使用',
                    },
                    {
                      title: '创建时间',
                      dataIndex: 'createdAt',
                      key: 'createdAt',
                      width: 150,
                      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
                    },
                  ]}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
                  暂无 API Key
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title="编辑用户"
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        confirmLoading={editing}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="用户名" name="username">
            <Input />
          </Form.Item>
          <Form.Item label="角色" name="role">
            <Select
              options={[
                { label: '普通用户', value: 'user' },
                { label: 'VIP', value: 'vip' },
                { label: '管理员', value: 'admin' },
              ]}
            />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={[
                { label: '正常', value: 'active' },
                { label: '禁用', value: 'suspended' },
                { label: '待验证', value: 'pending' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
