import { useState, useCallback, useEffect } from 'react';
import {
  Card, Input, Button, Space, Typography, Table, Tag, Modal,
  Form, InputNumber, Row, Col, Statistic, message, Tooltip, DatePicker, Alert,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined, EyeOutlined,
  WalletOutlined, LockOutlined, DollarOutlined,
} from '@ant-design/icons';
import {
  billingApi,
  type WalletListItem,
  type TransactionQuery,
  type TransactionItem,
  type WalletBalance,
} from '../services/billing';
import { formatDateTime } from '../utils/format-helpers';
import { usePermission } from '../hooks/usePermission';
import PageHeader from '../components/PageHeader';

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

/** 计费策略标签 */
const policyLabelMap: Record<string, string> = {
  internal: '内部计费',
  external: '外部计费',
  exempt: '免计费',
};

export default function WalletManagementPage() {
  const { hasPermission } = usePermission();
  const canBillingWrite = hasPermission('billing:write');

  const [reconRange, setReconRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [reconRows, setReconRows] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);

  // 钱包列表
  const [wallets, setWallets] = useState<WalletListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');

  // 详情视图：选中的 clientId
  const [selectedClientId, setSelectedClientId] = useState('');
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [txData, setTxData] = useState<{ items: TransactionItem[]; total: number }>({ items: [], total: 0 });
  const [txLoading, setTxLoading] = useState(false);
  const [txParams, setTxParams] = useState<TransactionQuery>({ page: 1, pageSize: 10 });

  // 充值弹窗
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditTarget, setCreditTarget] = useState('');
  const [creditForm] = Form.useForm();
  const [creditLoading, setCreditLoading] = useState(false);

  /** 加载钱包列表 */
  const fetchWallets = useCallback(async (p = page, ps = pageSize, kw = keyword) => {
    setLoading(true);
    try {
      const res: any = await billingApi.listWallets({ keyword: kw || undefined, page: p, pageSize: ps });
      setWallets(res?.data?.items || []);
      setTotal(res?.data?.total || 0);
    } catch {
      message.error('加载钱包列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  const loadReconciliation = useCallback(async () => {
    setReconLoading(true);
    try {
      const [from, to] = reconRange;
      const res: any = await billingApi.getSummary({
        groupBy: 'date',
        startDate: from.startOf('day').toISOString(),
        endDate: to.endOf('day').toISOString(),
      });
      setReconRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      message.error('加载对账汇总失败');
      setReconRows([]);
    } finally {
      setReconLoading(false);
    }
  }, [reconRange]);

  /** 初始加载 */
  useEffect(() => {
    fetchWallets(1, 20, '');
  }, []);

  useEffect(() => {
    loadReconciliation();
  }, [loadReconciliation]);

  /** 搜索 */
  const handleSearch = useCallback(() => {
    setPage(1);
    fetchWallets(1, pageSize, keyword);
  }, [keyword, pageSize, fetchWallets]);

  /** 分页 */
  const handlePageChange = useCallback((p: number, ps: number) => {
    setPage(p);
    setPageSize(ps);
    fetchWallets(p, ps, keyword);
  }, [keyword, fetchWallets]);

  /** 加载单个钱包详情 */
  const loadWalletDetail = useCallback(async (cid: string) => {
    setSelectedClientId(cid);
    setWalletLoading(true);
    setTxLoading(true);
    try {
      const [balRes, txRes]: any[] = await Promise.all([
        billingApi.getWallet(cid),
        billingApi.getWalletTransactions(cid, { page: 1, pageSize: 10 }),
      ]);
      setWallet(balRes?.data || null);
      setTxData(txRes?.data || { items: [], total: 0 });
      setTxParams({ page: 1, pageSize: 10 });
    } catch {
      message.error('加载钱包详情失败');
    } finally {
      setWalletLoading(false);
      setTxLoading(false);
    }
  }, []);

  /** 详情翻页 */
  const handleTxPageChange = useCallback(async (p: number, ps: number) => {
    if (!selectedClientId) return;
    setTxLoading(true);
    setTxParams({ page: p, pageSize: ps });
    try {
      const res: any = await billingApi.getWalletTransactions(selectedClientId, { page: p, pageSize: ps });
      setTxData(res?.data || { items: [], total: 0 });
    } catch {
      message.error('加载交易记录失败');
    } finally {
      setTxLoading(false);
    }
  }, [selectedClientId]);

  /** 打开充值弹窗 */
  const openCredit = useCallback((cid: string) => {
    setCreditTarget(cid);
    setCreditModalOpen(true);
  }, []);

  /** 提交充值 */
  const handleCredit = useCallback(async () => {
    try {
      const values = await creditForm.validateFields();
      setCreditLoading(true);
      await billingApi.creditWallet(creditTarget, {
        amount: values.amount,
        reason: values.reason,
      });
      message.success('充值成功');
      creditForm.resetFields();
      setCreditModalOpen(false);
      fetchWallets();
      if (selectedClientId === creditTarget) {
        loadWalletDetail(creditTarget);
      }
    } catch (err: any) {
      if (err?.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (!err?.errorFields) {
        message.error('充值失败');
      }
    } finally {
      setCreditLoading(false);
    }
  }, [creditTarget, creditForm, selectedClientId, fetchWallets, loadWalletDetail]);

  /** 钱包列表表格列定义 */
  const columns = [
    {
      title: 'Client ID',
      dataIndex: 'clientId',
      key: 'clientId',
      ellipsis: true,
      width: 260,
    },
    {
      title: '名称',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 150,
      render: (v: string) => v || '-',
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '0.0000'),
    },
    {
      title: '冻结',
      dataIndex: 'frozenAmount',
      key: 'frozenAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '0.0000'),
    },
    {
      title: '可用',
      dataIndex: 'available',
      key: 'available',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
          {v != null ? v.toFixed(4) : '0.0000'}
        </span>
      ),
    },
    {
      title: '计费策略',
      dataIndex: 'billingPolicy',
      key: 'billingPolicy',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'internal' ? 'blue' : v === 'exempt' ? 'green' : 'default'}>
          {policyLabelMap[v] || v}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (v: boolean) => (
        <Tag color={v !== false ? 'success' : 'error'}>
          {v !== false ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: any, record: WalletListItem) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => loadWalletDetail(record.clientId)}
            />
          </Tooltip>
          {canBillingWrite && (
            <Tooltip title="充值">
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => openCredit(record.clientId)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  /** 交易记录表格列定义 */
  const txColumns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
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
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '变更前',
      dataIndex: 'balanceBefore',
      key: 'balanceBefore',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '变更后',
      dataIndex: 'balanceAfter',
      key: 'balanceAfter',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '关联任务',
      dataIndex: 'relatedTaskId',
      key: 'relatedTaskId',
      width: 180,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      width: 160,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => formatDateTime(t),
    },
  ];

  return (
    <div>
      <PageHeader
        title="钱包管理"
        extra={(
          <>
            <Input
              placeholder="搜索 Client ID"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 300 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={handleSearch}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              搜索
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeyword('');
                setPage(1);
                fetchWallets(1, pageSize, '');
              }}
            >
              刷新
            </Button>
          </>
        )}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="余额告警"
        description="低余额事件（account_balance_low）请在「通知规则」中配置；全局默认阈值由服务配置 billing.wallet.lowBalanceThreshold 控制。"
      />

      <Card title="周期对账（按日汇总）" style={{ marginBottom: 16 }} loading={reconLoading}>
        <Space wrap style={{ marginBottom: 12 }}>
          <DatePicker.RangePicker value={reconRange} onChange={(v) => v && v[0] && v[1] && setReconRange([v[0], v[1]])} />
          <Button type="primary" onClick={() => loadReconciliation()}>查询</Button>
        </Space>
        <Table
          size="small"
          rowKey={(r) => String(r._id)}
          dataSource={reconRows}
          pagination={false}
          columns={[
            { title: '日期', dataIndex: '_id', width: 120 },
            { title: '笔数', dataIndex: 'count', width: 90 },
            {
              title: '预估费用',
              dataIndex: 'totalEstimatedCost',
              render: (v: number) => (v != null ? Number(v).toFixed(4) : '—'),
            },
            {
              title: '实际费用',
              dataIndex: 'totalActualCost',
              render: (v: number) => (v != null ? Number(v).toFixed(4) : '—'),
            },
          ]}
        />
      </Card>

      {/* 钱包列表 */}
      <Card style={{ marginBottom: 16 }}>
        <Table
          columns={columns}
          dataSource={wallets}
          rowKey="clientId"
          loading={loading}
          size="small"
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个钱包`,
            onChange: handlePageChange,
          }}
          rowClassName={(record) => record.clientId === selectedClientId ? 'ant-table-row-selected' : ''}
        />
      </Card>

      {/* 选中钱包的详情区域 */}
      {selectedClientId && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card loading={walletLoading} size="small">
                <Statistic
                  title="总余额"
                  value={wallet?.balance ?? 0}
                  precision={4}
                  prefix={<WalletOutlined />}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card loading={walletLoading} size="small">
                <Statistic
                  title="冻结金额"
                  value={wallet?.frozenAmount ?? 0}
                  precision={4}
                  prefix={<LockOutlined />}
                  valueStyle={{ color: '#faad14' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card loading={walletLoading} size="small">
                <Statistic
                  title="可用余额"
                  value={wallet?.available ?? 0}
                  precision={4}
                  prefix={<DollarOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Space>
                  <Typography.Text type="secondary">{selectedClientId}</Typography.Text>
                  {canBillingWrite && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => openCredit(selectedClientId)}
                    >
                      充值
                    </Button>
                  )}
                </Space>
              </Card>
            </Col>
          </Row>

          <Card title={`交易记录 — ${selectedClientId}`}>
            <Table
              columns={txColumns}
              dataSource={txData.items}
              rowKey="_id"
              loading={txLoading}
              size="small"
              scroll={{ x: 880 }}
              pagination={{
                current: txParams.page,
                pageSize: txParams.pageSize,
                total: txData.total,
                showSizeChanger: true,
                showTotal: (t) => `共 ${t} 条`,
                onChange: handleTxPageChange,
              }}
            />
          </Card>
        </>
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
            <Input value={creditTarget} disabled />
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
