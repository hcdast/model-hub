import Table from './AdminTable';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Typography, message } from 'antd';
import { modelApi } from '../services/api';
import { downloadJson } from '../utils/download-json';

export default function ModelImportModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<any>(); const [maasOnly, setMaasOnly] = useState(true);
  const [duplicate, setDuplicate] = useState('preserve'); const [plan, setPlan] = useState<any>();
  const [result, setResult] = useState<any>(); const [busy, setBusy] = useState(false);
  const generation = useRef(0), operation = useRef(false);
  useEffect(() => { generation.current++; setSource(undefined); setPlan(undefined); setResult(undefined); }, [open]);
  const invalidate = () => { generation.current++; setPlan(undefined); setResult(undefined); };
  const preview = async () => {
    if (operation.current) return;
    operation.current = true; const current = generation.current; setBusy(true);
    try { const res: any = await modelApi.previewImport({ source, maasOnly, duplicate }); if (current === generation.current) { setPlan(res.data); setResult(undefined); } }
    catch (e: any) { message.error(e.response?.data?.message || e.message); }
    finally { operation.current = false; setBusy(false); }
  };
  const commit = async (expected: number, planId: string) => {
    if (operation.current || expected !== generation.current) { message.error('导入选项已变化，请重新预览'); throw new Error('导入选项已变化'); }
    operation.current = true; setBusy(true);
    try { const res: any = await modelApi.commitImport(planId); setResult(res.data); setPlan(undefined); onSaved(); }
    catch (e: any) { message.error(e.response?.data?.message || e.message); throw e; }
    finally { operation.current = false; setBusy(false); }
  };
  const confirmCommit = () => {
    const expected = generation.current, currentPlan = plan;
    const dialog = Modal.confirm({ title: '提交已预览的有效记录？', content: '新建及更新立即生效；错误记录会逐条报告。', closable: false, maskClosable: false, keyboard: false, onOk: async () => {
      dialog.update({ cancelButtonProps: { disabled: true } });
      try { await commit(expected, currentPlan.planId); } finally { dialog.update({ cancelButtonProps: { disabled: false } }); }
    } });
  };
  return <Modal title="导入模型配置" open={open} onCancel={() => { if (!operation.current) onClose(); }} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={null} width={1100} destroyOnClose>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon message="先预览映射、校验和逐项差异，再提交。预览 10 分钟有效；修改来源或选项后需要重新预览。" />
      <Input aria-label="导入 JSON 文件" type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
        invalidate(); setSource(undefined); const current = generation.current;
        try { const file = e.target.files?.[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8MB'); const parsed = JSON.parse(await file.text()); if (current === generation.current) setSource(parsed); }
        catch (err: any) { if (current === generation.current) { setSource(undefined); message.error(err.message); } }
      }} />
      <Checkbox disabled={busy} checked={maasOnly} onChange={e => { setMaasOnly(e.target.checked); invalidate(); }}>仅 MaaS 的 i2v / t2v / r2v / v2v / i2i / t2i</Checkbox>
      <Space wrap>重复策略<Select aria-label="重复策略" disabled={busy} value={duplicate} style={{ width: 310 }} onChange={v => { setDuplicate(v); invalidate(); }} options={[
        { value: 'preserve', label: '更新配置，保留现有启停和定价（默认）' }, { value: 'skip', label: '跳过已存在模型' }, { value: 'replace', label: '覆盖模型字段（包括启停和定价）' },
      ]} /><Button loading={busy} disabled={!source || busy} onClick={preview}>校验并预览</Button></Space>
      {plan && <><Typography.Text>纳入 {plan.rows.length} 条，排除 {plan.excluded} 条；有错误的记录不写入。配置变化会触发版本冲突。</Typography.Text>
        <Table size="small" rowKey={(_, i) => String(i)} dataSource={plan.rows} pagination={{ pageSize: 10 }} columns={[
          { title: '模型', render: (_, r: any) => `${r.config.model_id} · ${r.config.model_type}` }, { title: '操作', dataIndex: 'action', width: 80 },
          { title: '校验', render: (_, r: any) => <span style={{ color: r.errors.length ? '#cf1322' : undefined }}>{[...r.errors, ...r.warnings].join('；') || '通过'}</span> },
        ]} expandable={{ expandedRowRender: (r: any) => <pre style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.diff, null, 2)}</pre> }} />
        <Space wrap><Button onClick={() => downloadJson(plan, 'model-import-preview.json')}>下载预览与错误报告</Button><Button type="primary" loading={busy} disabled={busy || !plan.rows.some((r: any) => r.action !== 'skip' && !r.errors.length)} onClick={confirmCommit}>提交有效记录</Button></Space>
      </>}
      {result && <><Alert type={result.failed ? 'warning' : 'success'} message={`导入完成：成功 ${result.success}，失败 ${result.failed}`} /><Button onClick={() => downloadJson(result, 'model-import-results.json')}>下载逐条结果</Button></>}
    </Space>
  </Modal>;
}
