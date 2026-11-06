import Table from '../components/AdminTable';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Card, Input, Button, Space, Typography, Tag, Modal,
  Form, InputNumber, Row, Col, Statistic, message, Tooltip, Alert, Divider,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined,
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

/** 冻结占余额比例（用于列表快速判断资金占用） */
function frozenRatioText(balance: number, frozen: number): string {
  if (balance == null || frozen == null || balance <= 0) return '—';
  return `${Math.min(100, Math.round((frozen / balance) * 1000) / 10)}%`;
}

export default function WalletManagementPage() {
  const { hasPermission } = usePermission();
  const canBillingWrite = hasPermission('billing:write');

  const [wallets, setWallets] = useState<WalletListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const listSequence = useRef(0), balanceSequence = useRef(0), txSequence = useRef(0);
  const currentDetail = useRef('');
  const [detailError, setDetailError] = useState('');

  /** 详情弹窗 */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailApiKey, setDetailApiKey] = useState('');
  /** 打开弹窗时的列表行快照（阈值、名称等） */
  const [detailSnapshot, setDetailSnapshot] = useState<WalletListItem | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [txData, setTxData] = useState<{ items: TransactionItem[]; total: number }>({ items: [], total: 0 });
  const [txLoading, setTxLoading] = useState(false);
  const [txParams, setTxParams] = useState<TransactionQuery>({ page: 1, pageSize: 10 });

  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditTarget, setCreditTarget] = useState('');
  const [creditForm] = Form.useForm();
  const [creditLoading, setCreditLoading] = useState(false);
  type PendingCredit = { operationId: string; amount: number; reason: string };
  const [pendingCredit, setPendingCredit] = useState<PendingCredit | null>(null);
  const creditLock = useRef(false);
  const pendingKey = (target: string) => `admin-pending-credit:${localStorage.getItem('username') || ''}:${target}`;

  const fetchWallets = useCallback(async (p = page, ps = pageSize, kw = appliedKeyword) => {
    const request = ++listSequence.current;
    setLoading(true);
    try {
      const res: any = await billingApi.listWallets({ keyword: kw || undefined, page: p, pageSize: ps });
      if (request !== listSequence.current) return;
      setWallets(res?.data?.items || []);
      setTotal(res?.data?.total || 0);
    } catch {
      if (request === listSequence.current) message.error('加载钱包列表失败');
    } finally {
      if (request === listSequence.current) setLoading(false);
    }
  }, [page, pageSize, appliedKeyword]);

  useEffect(() => {
    fetchWallets(1, 20, '');
    return () => { listSequence.current++; balanceSequence.current++; txSequence.current++; currentDetail.current = ''; };
  }, []);

  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedKeyword(keyword);
    fetchWallets(1, pageSize, keyword);
  }, [keyword, pageSize, fetchWallets]);

  const handlePageChange = useCallback((p: number, ps: number) => {
    setPage(p);
    setPageSize(ps);
    fetchWallets(p, ps, appliedKeyword);
  }, [appliedKeyword, fetchWallets]);

  const loadDetailData = useCallback(async (apiKey: string, txPage = 1, txPs = 10) => {
    const balanceRequest = ++balanceSequence.current, txRequest = ++txSequence.current;
    const isCurrent = () => currentDetail.current === apiKey && balanceRequest === balanceSequence.current;
    setDetailError('');
    setWalletLoading(true);
    setTxLoading(true);
    try {
      const [balRes, txRes]: any[] = await Promise.all([
        billingApi.getWallet(apiKey),
        billingApi.getWalletTransactions(apiKey, { page: txPage, pageSize: txPs }),
      ]);
      if (isCurrent()) setWallet(balRes?.data || null);
      if (currentDetail.current === apiKey && txRequest === txSequence.current) {
        setTxData(txRes?.data || { items: [], total: 0 });
        setTxParams({ page: txPage, pageSize: txPs });
      }
    } catch {
      if (isCurrent()) setDetailError('加载钱包详情失败，请重试');
    } finally {
      if (isCurrent()) setWalletLoading(false);
      if (currentDetail.current === apiKey && txRequest === txSequence.current) setTxLoading(false);
    }
  }, []);

  const openDetailModal = useCallback(
    (record: WalletListItem) => {
      const target = (record as any).clientRef || record.apiKey;
      currentDetail.current = target;
      setWallet(null); setTxData({ items: [], total: 0 }); setTxParams({ page: 1, pageSize: 10 });
      setDetailApiKey(target);
      setDetailSnapshot(record);
      setDetailOpen(true);
      loadDetailData((record as any).clientRef || record.apiKey, 1, 10);
    },
    [loadDetailData],
  );

  const closeDetailModal = useCallback(() => {
    currentDetail.current = ''; balanceSequence.current++; txSequence.current++;
    setDetailOpen(false);
    setDetailApiKey('');
    setDetailSnapshot(null);
    setWallet(null);
    setTxData({ items: [], total: 0 });
  }, []);

  const handleTxPageChange = useCallback(
    async (p: number, ps: number) => {
      if (!detailApiKey) return;
      const target = detailApiKey, request = ++txSequence.current;
      setTxLoading(true);
      setTxParams({ page: p, pageSize: ps });
      try {
        const res: any = await billingApi.getWalletTransactions(detailApiKey, { page: p, pageSize: ps });
        if (currentDetail.current === target && request === txSequence.current) setTxData(res?.data || { items: [], total: 0 });
      } catch {
        if (currentDetail.current === target && request === txSequence.current) message.error('加载交易记录失败');
      } finally {
        if (currentDetail.current === target && request === txSequence.current) setTxLoading(false);
      }
    },
    [detailApiKey],
  );

  const openCredit = useCallback((targetApiKey: string) => {
    if (creditLock.current) return;
    let pending: PendingCredit | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey(targetApiKey)) || 'null'); }
    catch { message.error('无法读取待确认的充值操作，请检查浏览器存储'); return; }
    setPendingCredit(pending);
    creditForm.resetFields();
    if (pending) creditForm.setFieldsValue(pending);
    setCreditTarget(targetApiKey);
    setCreditModalOpen(true);
  }, [creditForm]);

  const handleCredit = useCallback(async () => {
    if (creditLock.current) return;
    creditLock.current = true;
    setCreditLoading(true);
    try {
      const values = pendingCredit || await creditForm.validateFields();
      const operation = pendingCredit || { operationId: crypto.randomUUID(), amount: values.amount, reason: values.reason.trim() };
      // Persist before sending; a reload or lost response must reuse this receipt identity.
      sessionStorage.setItem(pendingKey(creditTarget), JSON.stringify(operation));
      setPendingCredit(operation);
      await billingApi.creditWallet(creditTarget, operation);
      sessionStorage.removeItem(pendingKey(creditTarget));
      setPendingCredit(null);
      message.success('充值成功');
      creditForm.resetFields();
      setCreditModalOpen(false);
      fetchWallets();
      if (detailOpen && detailApiKey === creditTarget) {
        await loadDetailData(creditTarget, 1, 10);
      }
    } catch (err: any) {
      if ([400, 403, 404, 422].includes(err?.response?.status)) {
        sessionStorage.removeItem(pendingKey(creditTarget)); setPendingCredit(null);
      }
      if (err?.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (!err?.errorFields) {
        message.error('充值失败');
      }
    } finally {
      creditLock.current = false;
      setCreditLoading(false);
    }
  }, [creditTarget, pendingCredit, creditForm, detailOpen, detailApiKey, fetchWallets, loadDetailData]);

  const columns = [
    {
      title: (
        <Tooltip title="仅展示掩码；详情与充值使用非敏感客户端引用">
          API Key
        </Tooltip>
      ),
      dataIndex: 'apiKey',
      key: 'apiKey',
      fixed: 'left' as const,
      ellipsis: true,
      width: 200,
      render: (apiKey: string) =>
        apiKey ? (
          <Typography.Text
            copyable={{ text: apiKey }}
            style={{
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              wordBreak: 'break-all',
            }}
          >
            {apiKey}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '名称',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 120,
      ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '0.00'),
    },
    {
      title: '冻结',
      dataIndex: 'frozenAmount',
      key: 'frozenAmount',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '0.00'),
    },
    {
      title: '可用',
      dataIndex: 'available',
      key: 'available',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
          {v != null ? v.toFixed(2) : '0.00'}
        </span>
      ),
    },
    {
      title: (
        <Tooltip title="冻结金额 / 总余额">冻结占用</Tooltip>
      ),
      key: 'frozenRatio',
      width: 88,
      align: 'center' as const,
      render: (_: unknown, r: WalletListItem) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {frozenRatioText(r.balance, r.frozenAmount)}
        </Typography.Text>
      ),
    },
    {
      title: (
        <Tooltip title="低于该可用余额时可能触发低余额告警（account_balance_low）">低余额阈值</Tooltip>
      ),
      dataIndex: 'lowBalanceThreshold',
      key: 'lowBalanceThreshold',
      width: 100,
      align: 'right' as const,
      render: (v: number | undefined) => (v != null && v > 0 ? v.toFixed(2) : '—'),
    },
    {
      title: '计费策略',
      dataIndex: 'billingPolicy',
      key: 'billingPolicy',
      width: 96,
      render: (v: string) => (
        <Tag color={v === 'internal' ? 'blue' : v === 'exempt' ? 'green' : 'default'}>
          {policyLabelMap[v] || v || '—'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 72,
      render: (v: boolean) => (
        <Tag color={v !== false ? 'success' : 'error'}>
          {v !== false ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 158,
      render: (t: string | undefined) => (t ? formatDateTime(t) : '—'),
    },
    {
      title: '最近更新',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 158,
      render: (t: string) => (t ? formatDateTime(t) : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 88,
      render: (_: unknown, record: WalletListItem) => (
        <Button type="link" size="small" onClick={() => openDetailModal(record)}>
          详情
        </Button>
      ),
    },
  ];

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
      render: (v: number) => (v != null ? v.toFixed(2) : '-'),
    },
    {
      title: '变更前',
      dataIndex: 'balanceBefore',
      key: 'balanceBefore',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '-'),
    },
    {
      title: '变更后',
      dataIndex: 'balanceAfter',
      key: 'balanceAfter',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toFixed(2) : '-'),
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
        title="余额充值"
        extra={(
          <>
            <Input
              placeholder="搜索 API Key / 名称"
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
              onClick={() => fetchWallets()}
            >
              刷新
            </Button>
            <Button
              onClick={() => {
                setKeyword('');
                setAppliedKeyword('');
                setPage(1);
                fetchWallets(1, pageSize, '');
              }}
            >
              重置筛选
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

      <Card title="钱包列表">
        <Table
          columns={columns}
          dataSource={wallets}
          rowKey={(r: any) => r.clientRef || r._id}
          loading={loading}
          size="small"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个钱包`,
            onChange: handlePageChange,
          }}
        />
      </Card>

      <Modal
        title="钱包详情"
        open={detailOpen}
        onCancel={closeDetailModal}
        width={1040}
        destroyOnClose
        footer={null}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {detailError && <Alert type="error" message={detailError} action={<Button onClick={() => loadDetailData(detailApiKey)}>重试</Button>} />}
          <div>
            <Typography.Text type="secondary" style={{ marginRight: 8 }}>API Key</Typography.Text>
            <Typography.Text copyable code style={{ fontSize: 12 }}>
              {detailApiKey}
            </Typography.Text>
            {detailSnapshot?.clientName ? (
              <Tag color="blue" style={{ marginLeft: 12 }}>{detailSnapshot.clientName}</Tag>
            ) : null}
          </div>
          <Row gutter={12} align="stretch">
            <Col xs={24} sm={canBillingWrite ? 6 : 8}>
              <Card loading={walletLoading} size="small" style={{ height: '100%' }}>
                <Statistic
                  title="总余额"
                  value={wallet?.balance ?? detailSnapshot?.balance ?? 0}
                  precision={2}
                  prefix={<WalletOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={canBillingWrite ? 6 : 8}>
              <Card loading={walletLoading} size="small" style={{ height: '100%' }}>
                <Statistic
                  title="冻结金额"
                  value={wallet?.frozenAmount ?? detailSnapshot?.frozenAmount ?? 0}
                  precision={2}
                  prefix={<LockOutlined />}
                  valueStyle={{ color: '#faad14' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={canBillingWrite ? 6 : 8}>
              <Card loading={walletLoading} size="small" style={{ height: '100%' }}>
                <Statistic
                  title="可用余额"
                  value={wallet?.available ?? detailSnapshot?.available ?? 0}
                  precision={2}
                  prefix={<DollarOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            {canBillingWrite && detailApiKey ? (
              <Col xs={24} sm={6}>
                <Card
                  size="small"
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 108,
                  }}
                >
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    block
                    onClick={() => openCredit(detailApiKey)}
                  >
                    充值
                  </Button>
                </Card>
              </Col>
            ) : null}
          </Row>
          {(detailSnapshot?.lowBalanceThreshold != null && detailSnapshot.lowBalanceThreshold > 0) || detailSnapshot?.billingPolicy ? (
            <Space wrap size="middle">
              {detailSnapshot?.lowBalanceThreshold != null && detailSnapshot.lowBalanceThreshold > 0 ? (
                <Typography.Text type="secondary">
                  低余额阈值（本钱包）：{detailSnapshot.lowBalanceThreshold.toFixed(2)} credits
                </Typography.Text>
              ) : null}
              {detailSnapshot?.billingPolicy ? (
                <Typography.Text type="secondary">
                  计费策略：
                  {policyLabelMap[detailSnapshot.billingPolicy] || detailSnapshot.billingPolicy}
                </Typography.Text>
              ) : null}
            </Space>
          ) : null}
          <Divider orientation="left" plain style={{ margin: '8px 0' }}>交易记录</Divider>
          <Table
            columns={txColumns}
            dataSource={txData.items}
            rowKey="_id"
            loading={txLoading}
            size="small"
            pagination={{
              current: txParams.page,
              pageSize: txParams.pageSize,
              total: txData.total,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`,
              onChange: handleTxPageChange,
            }}
          />
        </Space>
      </Modal>

      <Modal
        title="钱包充值"
        open={creditModalOpen}
        onOk={handleCredit}
        onCancel={() => {
          if (creditLock.current) return;
          creditForm.resetFields();
          setCreditModalOpen(false);
        }}
        confirmLoading={creditLoading}
        closable={!creditLoading}
        maskClosable={!creditLoading}
        keyboard={!creditLoading}
        cancelButtonProps={{ disabled: creditLoading }}
        okText={pendingCredit ? '核对并重试原充值' : '确认充值'}
        destroyOnClose
      >
        {pendingCredit && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="本次充值结果尚待确认" description="重试会核对同一笔充值，不会重复入账。金额和原因已锁定；关闭或刷新后重新打开仍可继续核对。" />}
        <Form form={creditForm} disabled={creditLoading || !!pendingCredit} layout="vertical" preserve={false}>
          <Form.Item label="API Key">
            <Input value={creditTarget} disabled />
          </Form.Item>
          <Form.Item
            name="amount"
            label="充值金额"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.01, message: '金额必须大于 0' },
            ]}
          >
            <InputNumber
              placeholder="请输入充值金额"
              style={{ width: '100%' }}
              min={0.01}
              step={0.01}
              precision={2}
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
