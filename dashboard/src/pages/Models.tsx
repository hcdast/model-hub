import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Card, Button, Space, Input, Select, Drawer, Switch, message, Tag, Spin,
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, BranchesOutlined, PlusOutlined, EditOutlined, DollarOutlined, UndoOutlined,
} from '@ant-design/icons';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import PricingModal from '../components/PricingModal';
import PageHeader from '../components/PageHeader';
import ModelDetailContent from '../components/ModelDetailContent';

export default function ModelsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [provider, setProvider] = useState<string | undefined>();
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingModel, setPricingModel] = useState<any | null>(null);

  const fetchData = async (
    p = page,
    ps = pageSize,
    filterOverride?: { keyword: string; provider: string | undefined; includeDisabled: boolean },
  ) => {
    const kw = filterOverride ? filterOverride.keyword : keyword;
    const prov = filterOverride ? filterOverride.provider : provider;
    const inc = filterOverride ? filterOverride.includeDisabled : includeDisabled;
    setLoading(true);
    try {
      const res: any = await modelApi.list({
        page: p,
        pageSize: ps,
        keyword: kw.trim() || undefined,
        provider: prov || undefined,
        includeDisabled: inc ? 'true' : undefined,
      });
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDisabled]);

  const openDetail = async (modelId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res: any = await modelApi.getDetail(modelId);
      setDetail(res.data || null);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载详情失败');
    }
    setDetailLoading(false);
  };

  const handleToggle = async (record: any, disabled: boolean) => {
    try {
      await modelApi.toggle(record.model_id, disabled);
      message.success(disabled ? '已禁用' : '已启用');
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  const openPricing = async (record: any) => {
    try {
      const res: any = await modelApi.getDetail(record.model_id);
      setPricingModel(res.data || null);
      setPricingOpen(true);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载定价信息失败');
    }
  };

  const columns = [
    { title: 'model_id', dataIndex: 'model_id', key: 'model_id', ellipsis: true, width: 200 },
    { title: 'provider_model_name', dataIndex: 'provider_model_name', key: 'provider_model_name', ellipsis: true, width: 280 },
    { title: 'model_name', dataIndex: 'model_name', key: 'model_name', ellipsis: true, width: 140 },
    { title: 'provider', dataIndex: 'provider', key: 'provider', width: 100 },
    { title: 'type', dataIndex: 'model_type', key: 'model_type', width: 120 },
    {
      title: '状态',
      key: 'disabled',
      width: 100,
      render: (_: unknown, r: any) => (
        <Space>
          <Tag color={r.disabled ? 'default' : 'green'}>{r.disabled ? '禁用' : '启用'}</Tag>
        </Space>
      ),
    },
    {
      title: '启用开关',
      key: 'sw',
      width: 100,
      render: (_: unknown, r: any) => (
        <Switch checked={!r.disabled} onChange={(v) => handleToggle(r, !v)} size="small" />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, r: any) => (
        <Space size={0} wrap>
          <Button type="link" size="small" onClick={() => openDetail(r.model_id)}>详情</Button>
          <Button
            type="link"
            size="small"
            icon={<DollarOutlined />}
            onClick={() => openPricing(r)}
          >
            定价
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/models/edit/${encodeURIComponent(r.model_id)}`)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<BranchesOutlined />}
            onClick={() => {
              const q = new URLSearchParams({
                action: 'new',
                model_id: r.model_id,
              });
              navigate(`/model-routing-rules?${q.toString()}`);
            }}
          >
            配置路由
          </Button>
        </Space>
      ),
    },
  ];

  const handleResetFilters = () => {
    setKeyword('');
    setProvider(undefined);
    setIncludeDisabled(false);
    void fetchData(1, pageSize, { keyword: '', provider: undefined, includeDisabled: false });
  };

  return (
    <div>
      <PageHeader
        title="模型配置"
        leftExtra={(
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/models/create')}
          >
            创建模型配置
          </Button>
        )}
        extra={(
          <>
            <Input
              placeholder="搜索 model_id / model_name"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => fetchData(1, pageSize)}
              style={{ width: 220 }}
              allowClear
            />
            <Input
              placeholder="provider 筛选"
              value={provider ?? ''}
              onChange={(e) => setProvider(e.target.value || undefined)}
              style={{ width: 140 }}
              allowClear
            />
            <Select
              value={includeDisabled ? 'yes' : 'no'}
              style={{ width: 120 }}
              options={[
                { value: 'no', label: '仅启用' },
                { value: 'yes', label: '含禁用' },
              ]}
              onChange={(v) => setIncludeDisabled(v === 'yes')}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchData(1, pageSize)}>
              查询
            </Button>
            <Button icon={<UndoOutlined />} onClick={handleResetFilters}>
              重置
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => fetchData(page, pageSize)}>
              刷新
            </Button>
          </>
        )}
      />

      <Card>
        <Table
          columns={columns}
          dataSource={items}
          rowKey={(r: any) => r.model_id || r.provider_model_name || r._id}
          loading={loading}
          size="small"
          scroll={{ x: 1300 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => fetchData(p, ps || pageSize),
          }}
        />
      </Card>

      <Drawer
        title={detail?.model_name || detail?.model_id || '模型详情'}
        width={920}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        destroyOnClose
        styles={{ body: { paddingBottom: 24 } }}
      >
        {detailLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin tip="加载中…" />
          </div>
        )}
        {!detailLoading && detail && (
          <ModelDetailContent detail={detail as Record<string, unknown>} />
        )}
      </Drawer>

      <PricingModal
        open={pricingOpen}
        modelConfig={pricingModel}
        onClose={() => { setPricingOpen(false); setPricingModel(null); }}
        onSaved={() => fetchData(page, pageSize)}
      />
    </div>
  );
}
