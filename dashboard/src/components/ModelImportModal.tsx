import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Typography, message } from 'antd';
import { modelApi } from '../services/api';
import { downloadJson } from '../utils/download-json';

export default function ModelImportModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<any>(); const [maasOnly, setMaasOnly] = useState(true);
  const [duplicate, setDuplicate] = useState('preserve'); const [plan, setPlan] = useState<any>();
  const [result, setResult] = useState<any>(); const [busy, setBusy] = useState(false);
  const invalidate = () => { setPlan(undefined); setResult(undefined); };
  const preview = async () => {
    setBusy(true); try { const res: any = await modelApi.previewImport({ source, maasOnly, duplicate }); setPlan(res.data); setResult(undefined); }
    catch (e: any) { message.error(e.response?.data?.message || e.message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); try { const res: any = await modelApi.commitImport(plan.planId); setResult(res.data); setPlan(undefined); onSaved(); }
    catch (e: any) { message.error(e.response?.data?.message || e.message); } finally { setBusy(false); }
  };
  return <Modal title="导入模型配置" open={open} onCancel={onClose} footer={null} width={1100} destroyOnClose>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon message="先预览映射、校验和逐项差异，再提交。预览 10 分钟有效；修改来源或选项后需要重新预览。" />
      <Input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
        invalidate(); try { const file = e.target.files?.[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8MB'); setSource(JSON.parse(await file.text())); }
        catch (err: any) { setSource(undefined); message.error(err.message); }
      }} />
      <Checkbox checked={maasOnly} onChange={e => { setMaasOnly(e.target.checked); invalidate(); }}>仅 MaaS 的 i2v / t2v / r2v / v2v / i2i / t2i</Checkbox>
      <Space>重复策略<Select value={duplicate} style={{ width: 310 }} onChange={v => { setDuplicate(v); invalidate(); }} options={[
        { value: 'preserve', label: '更新配置，保留现有启停和定价（默认）' }, { value: 'skip', label: '跳过已存在模型' }, { value: 'replace', label: '覆盖模型字段（包括启停和定价）' },
      ]} /><Button loading={busy} disabled={!source} onClick={preview}>校验并预览</Button></Space>
      {plan && <><Typography.Text>纳入 {plan.rows.length} 条，排除 {plan.excluded} 条；有错误的记录不写入。配置变化会触发版本冲突。</Typography.Text>
        <Table size="small" rowKey={(_, i) => String(i)} dataSource={plan.rows} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} columns={[
          { title: '模型', render: (_, r: any) => `${r.config.model_id} · ${r.config.model_type}` }, { title: '操作', dataIndex: 'action', width: 80 },
          { title: '校验', render: (_, r: any) => <span style={{ color: r.errors.length ? '#cf1322' : undefined }}>{[...r.errors, ...r.warnings].join('；') || '通过'}</span> },
        ]} expandable={{ expandedRowRender: (r: any) => <pre style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.diff, null, 2)}</pre> }} />
        <Space><Button onClick={() => downloadJson(plan, 'model-import-preview.json')}>下载预览与错误报告</Button><Button type="primary" loading={busy} disabled={!plan.rows.some((r: any) => r.action !== 'skip' && !r.errors.length)} onClick={() => Modal.confirm({ title: '提交已预览的有效记录？', content: '新建及更新立即生效；错误记录会逐条报告。', onOk: commit })}>提交有效记录</Button></Space>
      </>}
      {result && <><Alert type={result.failed ? 'warning' : 'success'} message={`导入完成：成功 ${result.success}，失败 ${result.failed}`} /><Button onClick={() => downloadJson(result, 'model-import-results.json')}>下载逐条结果</Button></>}
    </Space>
  </Modal>;
}
