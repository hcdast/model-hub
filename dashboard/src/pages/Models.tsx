import Table from '../components/AdminTable';
import { usePermission } from '../hooks/usePermission';
import dayjs from 'dayjs';
import type { TableColumnsType } from 'antd';
import { useRequest } from '../hooks/useRequest';
import { pickModelConfig } from '@model-hub/common/utils/model-contract';
import { downloadJson } from '../utils/download-json';
import ModelImportModal from '../components/ModelImportModal';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { Card, Button, Space, Input, Select, Drawer, Switch, message, Tag, Spin, Modal, Typography, Pagination, Dropdown, Checkbox,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, EditOutlined,
} from '@ant-design/icons';
import { modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import PricingModal from '../components/PricingModal';
import PageHeader from '../components/PageHeader';
import { PageActions } from '../components/PageFrame';
import ModelDetailContent from '../components/ModelDetailContent';
import ProviderSelect from '../components/ProviderSelect';
import RequestFeedback from '../components/RequestFeedback';

/** 启用状态筛选：默认全部（不传 status） */
type ModelStatusFilter = 'all' | 'enabled' | 'disabled';

export default function ModelsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('model:update'), canCreate = hasPermission('model:create'), canDelete = hasPermission('model:delete');
  const [search, setSearch] = useSearchParams(); const location = useLocation();
  const page = Number(search.get('page')) || 1, pageSize = Number(search.get('pageSize')) || 20;
  const keyword = search.get('keyword') || '', provider = search.get('provider') || undefined;
  const statusFilter = (search.get('status') || 'all') as ModelStatusFilter, feature = search.get('model_type') || undefined;
  const sortOrder = search.get('sort_order') === 'asc' ? 'asc' : 'desc';
  const update = (patch: Record<string, any>) => { const next = new URLSearchParams(search); Object.entries({ page: 1, ...patch } as Record<string, any>).forEach(([k,v]) => v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))); setSearch(next, { replace: true }); };
  const { data = { items: [], total: 0 }, error, lastSuccess, loading, refresh: fetchData } = useRequest<any>(async () => (await modelApi.list({ page, pageSize, keyword, provider, model_type: feature, status: statusFilter, sort_order: sortOrder }) as any).data, { deps: [search.toString()] });
  const items = data.items, total = data.total;
  const [detail, setDetail] = useState<any | null>(null); const [detailOpen, setDetailOpen] = useState(false); const [detailLoading, setDetailLoading] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false); const [pricingModel, setPricingModel] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false); const [selected, setSelected] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const bulkLock = useRef(false);
  const [bulkReport, setBulkReport] = useState<{ rows: any[]; patch: any; results: any[] } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['model_id', 'provider', 'model_type', 'disabled', 'sw', 'update_time', 'actions']);
  useEffect(() => { setSelected([]); }, [search.toString()]);
  const bulk = (patch: any, rows = [...selected]) => Modal.confirm({ title: `确认修改选中 ${rows.length} 条模型？`, width: 700,
    content: <div><Typography.Paragraph>立即生效，统一校验完整配置和编辑版本。失败记录会保留在结果报告。</Typography.Paragraph><pre style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify({ models: rows.map(r => ({ model_id: r.model_id, revision: r.revision || 0, ...(patch.unit_price_map ? { before: r.unit_price_map, after: patch.unit_price_map } : { before: { disabled: r.disabled }, after: patch }) })), patch }, null, 2)}</pre></div>,
    onOk: async () => {
      if (bulkLock.current) return;
      bulkLock.current = true; setBulkRunning(true);
      try {
        const r: any = await modelApi.bulk(rows.map(r => ({ id: r._id, expected_revision: r.revision || 0 })), patch);
        const results = r.data.results, failedIds = new Set(results.filter((v: any) => v.status === 'failed').map((v: any) => v.id));
        setBulkReport(previous => previous && previous.patch === patch ? {
          patch, rows: previous.rows.map(row => rows.find(current => current._id === row._id) || row),
          results: previous.results.map(result => results.find((current: any) => current.id === result.id) || result),
        } : { rows, patch, results });
        setSelected(rows.filter(row => failedIds.has(row._id)));
        message.info(`已处理 ${rows.length} 条，成功 ${results.length - failedIds.size} 条，失败 ${failedIds.size} 条`);
        await fetchData();
      } catch (e) { ErrorHandler.handleApiError(e, '批量更新失败'); throw e; }
      finally { bulkLock.current = false; setBulkRunning(false); }
    },
  });
  const retryFailed = async () => {
    if (!bulkReport || bulkLock.current) return;
    bulkLock.current = true; setBulkRunning(true);
    try {
      const failedIds = new Set(bulkReport.results.filter(result => result.status === 'failed').map(result => result.id));
      const rows = await Promise.all(bulkReport.rows.filter(row => failedIds.has(row._id)).map(async row => (await modelApi.getDetail(row._id, { byMongoId: true }) as any).data));
      // Fetch current revisions and show the new differences for confirmation before applying.
      bulk(bulkReport.patch, rows);
    } catch (error) { ErrorHandler.handleApiError(error, '读取失败模型的最新配置失败'); }
    finally { bulkLock.current = false; setBulkRunning(false); }
  };
  const bulkPrice = () => { let value = ''; Modal.confirm({ title: '批量替换完整价格表', width: 720, content: <><Typography.Paragraph>所选模型将使用相同完整价格表。下一步会展示范围和价格差异；若规则引用档位不存在，服务端拒绝该条。</Typography.Paragraph><Input.TextArea rows={10} onChange={e => { value = e.target.value; }} placeholder='{ "default": { "cost_unit_price": 0, "sale_unit_price": 0.01, "unit_credit": 1, "original_unit_credit": 1 } }' /></>, onOk: () => { try { const unit_price_map = JSON.parse(value); setTimeout(() => bulk({ unit_price_map }), 0); } catch { message.error('价格表 JSON 无效'); return Promise.reject(); } } }); };
  const exportModels = async () => { setBusy(true); try { const r: any = await modelApi.export({ provider, keyword, model_type: feature, status: statusFilter }); downloadJson(r.data, 'model-config-export.json'); message.success(`已导出 ${r.data.total} 条模型配置`); } catch (e) { ErrorHandler.handleApiError(e, '导出失败'); } finally { setBusy(false); } };
  const clone = async (row: any) => { let modelId = `${row.model_id}-copy`, providerModel = `${row.provider_model_name || row.model_id}-copy`; Modal.confirm({ title: '复制为新模型（默认禁用）', content: <Space direction="vertical"><Input defaultValue={modelId} onChange={e => { modelId = e.target.value; }} addonBefore="model_id" /><Input defaultValue={providerModel} onChange={e => { providerModel = e.target.value; }} addonBefore="provider_model_name" /></Space>, onOk: async () => { const r: any = await modelApi.getDetail(row._id, { byMongoId: true }); await modelApi.create({ ...pickModelConfig(r.data), model_id: modelId, provider_model_name: providerModel, model_name: `${row.model_name} 副本`, disabled: true }); fetchData(); } }); };

  const refreshAfterDelete = async (deletedIds: string[]) => {
    setSelected(rows => rows.filter(row => !deletedIds.includes(row._id)));
    const lastPage = Math.max(1, Math.ceil((total - deletedIds.length) / pageSize));
    if (page > lastPage) update({ page: lastPage });
    else await fetchData();
  };

  const confirmDelete = (rows: any[], batch: boolean) => Modal.confirm({
    title: batch ? `确认删除选中的 ${rows.length} 条模型配置？` : `确认删除模型 ${rows[0].model_id}？`,
    width: 760, okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
    content: <><Typography.Paragraph>删除后无法恢复；仍被路由引用或有未结束任务的配置将拒绝删除。</Typography.Paragraph>
      <Table size="small" rowKey="_id" pagination={false} scroll={{ y: 260 }} dataSource={rows} columns={[
        { title: '模型', dataIndex: 'model_id' }, { title: '厂商', dataIndex: 'provider' }, { title: '厂商模型', dataIndex: 'provider_model_name' },
      ]} /></>,
    onOk: async () => {
      setDeleting(true);
      try {
        if (batch) {
          const res: any = await modelApi.bulkDelete(rows.map(row => ({ id: row._id, expected_revision: row.revision || 0 })));
          const results = res.data.results;
          const deletedIds = results.filter((result: any) => result.status === 'success').map((result: any) => result.id);
          const failed = results.filter((result: any) => result.status === 'failed');
          await refreshAfterDelete(deletedIds);
          if (failed.length) Modal.warning({ title: `删除成功 ${deletedIds.length} 条，失败 ${failed.length} 条`, width: 760,
            content: <Table size="small" rowKey="id" pagination={false} scroll={{ y: 300 }} dataSource={failed.map((result: any) => ({ ...result, model_id: rows.find(row => row._id === result.id)?.model_id || result.id }))} columns={[{ title: '模型', dataIndex: 'model_id' }, { title: '失败原因', dataIndex: 'error' }]} />,
          });
          else message.success(`已删除 ${deletedIds.length} 条模型配置`);
        } else {
          await modelApi.remove(rows[0]._id, rows[0].revision || 0);
          await refreshAfterDelete([rows[0]._id]);
          message.success('模型配置已删除');
        }
      } catch (error) {
        ErrorHandler.handleApiError(error, '删除失败');
        throw error;
      } finally { setDeleting(false); }
    },
  });

  const openDetail = async (record: any) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res: any = await modelApi.getDetail(record._id, { byMongoId: true });
      setDetail(res.data || null);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载详情失败');
    }
    setDetailLoading(false);
  };

  const handleToggle = async (record: any, disabled: boolean) => {
    try {
      const res: any = await modelApi.toggle({ id: record._id, disabled, expected_revision: record.revision || 0 });
      if (res.code !== 0) throw { response: { data: res } };
      if (res.data?.disabled !== disabled) throw new Error('模型状态未更新');
      message.success(disabled ? '已禁用' : '已启用');
      fetchData();
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  const openPricing = async (record: any) => {
    try {
      const res: any = await modelApi.getDetail(record._id, { byMongoId: true });
      setPricingModel(res.data || null);
      setPricingOpen(true);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载定价信息失败');
    }
  };

  const columns: TableColumnsType<any> = [
    { title: '模型', dataIndex: 'model_id', key: 'model_id', width: 240, render: (id, r) => <div style={{ minWidth: 0 }}><Typography.Text strong ellipsis={{ tooltip: r.model_name }} style={{ display: 'block' }}>{r.model_name || id}</Typography.Text><Typography.Text type="secondary" copyable={{ text: id }} ellipsis={{ tooltip: id }} style={{ display: 'block' }}>{id}</Typography.Text></div> },
    { title: '厂商模型标识', dataIndex: 'provider_model_name', key: 'provider_model_name', width: 240, render: value => <Typography.Text ellipsis={{ tooltip: value }} style={{ display: 'block' }}>{value}</Typography.Text> },
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
        <Switch disabled={!canUpdate} checked={!r.disabled} onChange={(v) => handleToggle(r, !v)} size="small" />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'update_time',
      key: 'update_time',
      width: 180,
      sorter: true,
      sortOrder: sortOrder === 'asc' ? 'ascend' : 'descend',
      sortDirections: ['descend', 'ascend', 'descend'],
      render: (value: number | null | undefined) => value != null && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, r: any) => (
        <Space size={0} wrap>
          <Button type="link" size="small" onClick={() => openDetail(r)}>详情</Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canUpdate} onClick={() => navigate(`/models/edit/${encodeURIComponent(r._id)}?returnTo=${encodeURIComponent(location.pathname + location.search)}`)}
          >
            编辑
          </Button>
          <Dropdown trigger={['click']} menu={{ items: [
            ...(canUpdate ? [{ key: 'price', label: '定价', onClick: () => openPricing(r) }] : []),
            ...(canCreate ? [{ key: 'copy', label: '复制', onClick: () => clone(r) }, { key: 'route', label: '配置路由', onClick: () => navigate(`/model-routing-rules?${new URLSearchParams({ action: 'new', model_id: r.model_id })}`) }] : []),
            ...(canDelete ? [{ key: 'delete', label: '删除', danger: true, disabled: deleting, onClick: () => confirmDelete([r], false) }] : []),
          ] }} disabled={!canUpdate && !canCreate && !canDelete}><Button type="link" size="small" aria-label={`更多操作 ${r.model_id}`}>更多</Button></Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="模型配置"
        leftExtra={<Space wrap>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/models/create')}>创建模型配置</Button>}{canCreate && canUpdate && <Button onClick={() => setImportOpen(true)}>导入 JSON</Button>}<Button loading={busy} onClick={exportModels}>导出全部筛选结果</Button></Space>}
        extra={<Space wrap>
          <Input.Search placeholder="搜索 model_id / model_name" defaultValue={keyword} key={keyword} allowClear onSearch={v => update({ keyword: v })} style={{ width: 240 }} />
          <ProviderSelect value={provider} onChange={v => update({ provider: v })} style={{ width: 150 }} />
          <Select placeholder="能力类型" allowClear value={feature} style={{ width: 165 }} onChange={v => update({ model_type: v })} options={[
            ['imageToVideo', 'i2v 图生视频'], ['textToVideo', 't2v 文生视频'], ['referenceToVideo', 'r2v 参考生视频'], ['videoToVideo', 'v2v 视频生视频'], ['imageToImage', 'i2i 图生图'], ['textToImage', 't2i 文生图'], ['characterSwap', '角色替换'], ['textGenerate', '语言模型'], ['tts', '语音生成'],
          ].map(([value,label]) => ({ value,label }))} />
          <Select value={statusFilter} style={{ width: 110 }} options={[{ value: 'all', label: '全部状态' }, { value: 'enabled', label: '启用' }, { value: 'disabled', label: '禁用' }]} onChange={v => update({ status: v })} />
          <Dropdown trigger={['click']} dropdownRender={() => <Card size="small"><Checkbox.Group value={visibleColumns} onChange={values => setVisibleColumns(values as string[])}><Space direction="vertical">{columns.map(column => <Checkbox key={String(column.key)} value={String(column.key)} disabled={column.key === 'model_id' || column.key === 'actions'}>{String(column.title)}</Checkbox>)}</Space></Checkbox.Group></Card>}><Button>显示列</Button></Dropdown>
          <Button onClick={() => setSearch({})}>重置</Button><Button icon={<ReloadOutlined />} onClick={() => fetchData()}>刷新</Button>
        </Space>}
      />
      <ModelImportModal open={importOpen} onClose={() => setImportOpen(false)} onSaved={() => fetchData()} />
      <RequestFeedback error={error} hasData={!!lastSuccess} retry={fetchData} />

      <Card>
        <Table
          rowSelection={canUpdate || canDelete ? { selectedRowKeys: selected.map(r => r._id), onChange: (_, rows) => setSelected(rows), getCheckboxProps: () => ({ disabled: deleting }) } : undefined}
          columns={columns.filter(column => visibleColumns.includes(String(column.key)))}
          dataSource={items}
          rowKey={(r: any) => String(r._id ?? `${r.model_id}|${r.provider}|${r.provider_model_name}`)}
          loading={loading}
          locale={{ emptyText: error ? '加载失败，请点击重试' : undefined }}
          size="small"
          onChange={(_pagination, _filters, sorter, extra) => {
            if (extra.action === 'sort') {
              const current = Array.isArray(sorter) ? sorter[0] : sorter;
              update({ sort_order: current.order === 'ascend' ? 'asc' : 'desc' });
            }
          }}
          pagination={false}
        />
      </Card>

      <Modal title="批量处理结果" open={!!bulkReport} onCancel={() => { if (!bulkRunning) setBulkReport(null); }} width={800}
        footer={<Space><Button onClick={() => bulkReport && downloadJson({ results: bulkReport.results }, 'model-bulk-results.json')}>下载结果报告</Button>
          <Button type="primary" loading={bulkRunning} disabled={!bulkReport?.results.some(result => result.status === 'failed')} onClick={retryFailed}>仅重试失败项</Button>
          <Button disabled={bulkRunning} onClick={() => setBulkReport(null)}>关闭</Button></Space>}>
        <Table size="small" rowKey="id" pagination={false} dataSource={bulkReport?.results || []} columns={[
          { title: '模型', key: 'model', render: (_: any, result: any) => bulkReport?.rows.find(row => row._id === result.id)?.model_id || result.id },
          { title: '处理结果', dataIndex: 'status', render: (status: string) => <Tag color={status === 'failed' ? 'red' : 'green'}>{status === 'failed' ? '失败' : '成功'}</Tag> },
          { title: '失败原因', dataIndex: 'error', render: (error: string) => error || '—' },
        ]} />
      </Modal>

      <PageActions>
        <div className="admin-table-footer">
          <Space wrap>
            {(canUpdate || canDelete) && <span>已选 {selected.length} 条</span>}
            {canUpdate && <><Button disabled={!selected.length || deleting} onClick={() => bulk({ disabled: false })}>批量启用</Button><Button disabled={!selected.length || deleting} onClick={() => bulk({ disabled: true })}>批量禁用</Button><Button disabled={!selected.length || deleting} onClick={bulkPrice}>批量改价</Button></>}
            {canDelete && <Button danger disabled={!selected.length || deleting} onClick={() => confirmDelete([...selected], true)}>批量删除</Button>}
          </Space>
          <Pagination current={page} pageSize={pageSize} total={total} showSizeChanger showTotal={t => `共 ${t} 条`} disabled={deleting} onChange={(p, ps) => update({ page: p, pageSize: ps })} />
        </div>
      </PageActions>

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
        onSaved={() => fetchData()}
      />
    </div>
  );
}
