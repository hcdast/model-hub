import { useState, useCallback } from 'react';
import {
  Card, Input, Button, Space, Typography, Table, Tag, Modal,
  Form, InputNumber, Statistic, Row, Col, message,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined,
  WalletOutlined, LockOutlined, DollarOutlined,
} from '@ant-design/icons';
import {
  billingApi,
  type TransactionQuery,
  type TransactionItem,
  type WalletBalance,
} from '../services/billing';
import { useRequest } from '../hooks/useRequest';
import { formatDateTime } from '../utils/format-helpers';

/** 交易类型 → 中文标签映射 */
const txTypeLabelMap: Record<string, string> = {
  credit: '充值',
  debit: '扣费',
  freeze: '冻结',
  unfreeze: '解冻',
};

/** 交易类型 → 颜色映射 */
const txTypeColorMap: Record<string, string> = {
  credit: 'green',
  debit: 'red',
  freeze: 'orange',
  unfreeze: 'blue',
};

export default function WalletManagementPage() {
  // 当前查询的 clientId
  const [clientId, setClientId] = useState('');
  // 搜索框输入值（未提交）
  const [searchInput, setSearchInput] = useState('');
  // 充值弹窗可见状态
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  // 充值表单实例
  const [creditForm] = Form.useForm();
  // 充值请求 loading
  const [creditLoading, setCreditLoading] = useState(false);

  // 交易记录分页参数
  const [txParams, setTxParams] = useState<TransactionQuery>({
    page: 1,
    pageSize: 20,
  });

  // 查询钱包余额（手动触发）
  const {
    data: wallet,
    loading: walletLoading,
    refresh: refreshWallet,
  } = useRequest<WalletBalance>(
    () => billingApi.getWallet(clientId).then((res: any) => res.data),
    { manual: true },
  );

  // 查询交易记录（手动触发）
  const {
    data: txData,
    loading: txLoading,
    refresh: refreshTx,
  } = useRequest<{ items: TransactionItem[]; total: number }>(
    () =>
      billingApi
        .getWalletTransactions(clientId, txParams)
        .then((res: any) => res.data || { items: [], total: 0 }),
    { manual: true },
  );

  /** 执行查询：获取钱包余额和交易记录 */
  const handleSearch = useCallback(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      message.warning('请输入 Client ID');
      return;
    }
    setClientId(trimmed);
    setTxParams((prev) => ({ ...prev, page: 1 }));
    // 延迟一帧确保 clientId 状态已更新
    setTimeout(() => {
      refreshWallet();
      refreshTx();
    }, 0);
  }, [searchInput, refreshWallet, refreshTx]);

  /** 刷新当前数据 */
  const handleRefresh = useCallback(() => {
    if (!clientId) return;
    refreshWallet();
    refreshTx();
  }, [clientId, refreshWallet, refreshTx]);

  /** 翻页时重新查询交易记录 */
  const handlePageChange = useCallback(
    (page: number, pageSize: number) => {
      setTxParams((prev) => ({ ...prev, page, pageSize }));
      setTimeout(() => refreshTx(), 0);
    },
    [refreshTx],
  );

  /** 提交充值 */
  const handleCredit = useCallback(async () => {
    try {
      const values = await creditForm.validateFields();
      setCreditLoading(true);
      await billingApi.creditWallet(clientId, {
        amount: values.amount,
        reason: values.reason,
      });
      message.success('充值成功');
      creditForm.resetFields();
      setCreditModalOpen(false);
      // 刷新余额和交易记录
      refreshWallet();
      refreshTx();
    } catch (err: any) {
      if (err?.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (!err?.errorFields) {
        message.error('充值失败');
      }
    } finally {
      setCreditLoading(false);
    }
  }, [clientId, creditForm, refreshWallet, refreshTx]);

  /** 交易记录表格列定义 */
  const txColumns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: string) => (
        <Tag color={txTypeColorMap[v] || 'default'}>
          {txTypeLabelMap[v] || v}
        </Tag>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '变更前余额',
      dataIndex: 'balanceBefore',
      key: 'balanceBefore',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '变更后余额',
      dataIndex: 'balanceAfter',
      key: 'balanceAfter',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '关联任务',
      dataIndex: 'relatedTaskId',
      key: 'relatedTaskId',
      width: 200,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      width: 200,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (t: string) => formatDateTime(t),
    },
  ];

  return (
    <div>
      <Typography.Title level={4}>钱包管理</Typography.Title>

      {/* 搜索区域 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Input
            placeholder="请输入 Client ID"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 320 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={handleSearch}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} disabled={!clientId}>
            刷新
          </Button>
        </Space>
      </Card>

      {/* 余额卡片区域 — 仅在查询到钱包数据后显示 */}
      {clientId && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card loading={walletLoading}>
              <Statistic
                title="总余额"
                value={wallet?.balance ?? 0}
                precision={4}
                prefix={<WalletOutlined />}
                suffix="credits"
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card loading={walletLoading}>
              <Statistic
                title="冻结金额"
                value={wallet?.frozenAmount ?? 0}
                precision={4}
                prefix={<LockOutlined />}
                suffix="credits"
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card loading={walletLoading}>
              <Statistic
                title="可用余额"
                value={wallet?.available ?? 0}
                precision={4}
                prefix={<DollarOutlined />}
                suffix="credits"
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 充值按钮 + 交易记录表格 */}
      {clientId && (
        <Card
          title="交易记录"
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreditModalOpen(true)}
            >
              充值
            </Button>
          }
        >
          <Table
            columns={txColumns}
            dataSource={txData?.items || []}
            rowKey="_id"
            loading={txLoading}
            size="small"
            scroll={{ x: 1060 }}
            pagination={{
              current: txParams.page,
              pageSize: txParams.pageSize,
              total: txData?.total || 0,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`,
              onChange: handlePageChange,
            }}
          />
        </Card>
      )}

      {/* 充值弹窗 */}
      <Modal
        title="钱包充值"
        open={creditModalOpen}
        onOk={handleCredit}
        onCancel={() => {
          creditForm.resetFields();
          setCreditModalOpen(false);
        }}
        confirmLoading={creditLoading}
        destroyOnClose
      >
        <Form form={creditForm} layout="vertical" preserve={false}>
          <Form.Item label="Client ID">
            <Input value={clientId} disabled />
          </Form.Item>
          <Form.Item
            name="amount"
            label="充值金额"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.0001, message: '金额必须大于 0' },
            ]}
          >
            <InputNumber
              placeholder="请输入充值金额"
              style={{ width: '100%' }}
              min={0.0001}
              step={1}
              precision={4}
              addonAfter="credits"
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="充值原因"
            rules={[{ required: true, message: '请输入充值原因' }]}
          >
            <Input.TextArea
              placeholder="请输入充值原因"
              rows={3}
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
