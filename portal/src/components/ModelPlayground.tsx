import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Input, Select, Space, Tabs, Tag } from 'antd';
import type { CatalogModelDoc } from '../services/catalog-api';
import { playgroundApi, PlaygroundTask } from '../services/playground-api';
import { buildModelExamples } from '../utils/model-doc-example';
import { validateParams } from '../../../src/common/utils/param-validator';
import { estimatePublicModelPrice } from '../../../src/common/utils/model-pricing';
import ModelParamField from './Node/ModelParamField';
import NodeOutputPreview from './Node/NodeOutputPreview';
import { modelOutputPreview } from '../utils/model-output-preview';

const terminal = new Set(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED']);
function defaults(doc: CatalogModelDoc) { return Object.fromEntries(doc.params.filter(p => p.default !== undefined).map(p => [p.name, p.default])); }
export default function ModelPlayground({ doc }: { doc: CatalogModelDoc }) {
  const [input, setInput] = useState<Record<string, unknown>>(() => defaults(doc));
  const [json, setJson] = useState(() => JSON.stringify(defaults(doc), null, 2));
  const [jsonError, setJsonError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [task, setTask] = useState<PlaygroundTask>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const taskKey = useRef('');
  const alive = useRef(true);
  const pending = useRef<{ fingerprint: string; key: string }>();
  useEffect(() => { alive.current = true; return () => { alive.current = false; taskKey.current = ''; }; }, []);
  const change = (next: Record<string, unknown>) => { const values = { ...defaults(doc), ...next }; setInput(values); setJson(JSON.stringify(values, null, 2)); setJsonError(''); };
  const defs = Object.fromEntries(doc.params.map(p => [p.name, p]));
  const validation = validateParams(input, defs, doc.params_rules);
  let estimate: ReturnType<typeof estimatePublicModelPrice> | undefined;
  let priceError = '';
  if (validation.valid && doc.public_pricing && Object.keys(doc.public_pricing.tiers).length) {
    try { estimate = estimatePublicModelPrice(doc.model_type, doc.public_pricing, validation.sanitized); }
    catch { priceError = '当前输入缺少可用价格，请检查模型计费配置。'; }
  }
  const taskId = task?.taskId;
  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const poll = async () => {
      try {
        const next = await playgroundApi.get(taskKey.current, taskId, controller.signal);
        if (controller.signal.aborted) return;
        setTask(next); setError('');
        if (!terminal.has(next.status)) {
          if (++count >= 900) { setError('自动查询已暂停，可手动恢复；任务仍在服务端运行。'); return; }
          timer = setTimeout(poll, 2000);
        }
      } catch { if (!controller.signal.aborted) setError('查询失败。可恢复查询已有任务，无需重新生成。'); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [taskId, retry]);
  const request = { model_id: doc.model_id, input: validation.sanitized, options: { featureType: doc.model_type,
    ...(doc.config_id ? { configId: doc.config_id, configRevision: doc.revision || 0 } : {}) } };
  const running = !!task && !terminal.has(task.status);
  const submit = async () => {
    if (busy || running || jsonError || priceError || !validation.valid) return;
    if (!apiKey.trim().startsWith('mh_')) { setError('请输入有效的 mh_ API Key'); return; }
    setBusy(true); setError('');
    const fingerprint = JSON.stringify(request);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    taskKey.current = apiKey.trim();
    try {
      const result = await playgroundApi.create(taskKey.current, request, pending.current.key);
      if (alive.current) { setTask(result); pending.current = undefined; }
    } catch (err: unknown) {
      if (alive.current) {
        const detail = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string; errors?: Array<{ message: string }> } } }).response?.data : undefined;
        setError([typeof detail?.message === 'string' ? detail.message : '提交未确认，请检查配置、余额和 API Key。相同输入重试会复用幂等键。', ...(detail?.errors || []).map(e => e.message)].join('；'));
      }
    } finally { if (alive.current) setBusy(false); }
  };
  const ordered = [...doc.params].sort((a, b) => {
    const rank = (name: string) => { const index = doc.ui_schema?.order?.indexOf(name) ?? -1; return index < 0 ? 999 : index; };
    return rank(a.name) - rank(b.name);
  });
  const field = (p: typeof doc.params[number]) => <ModelParamField key={p.name} param={p} value={input[p.name]} parameters={input} onChange={value => change({ ...input, [p.name]: value })} />;
  const advanced = new Set(doc.ui_schema?.advanced || []);
  const groups = Object.entries(doc.ui_schema?.groups || {});
  const grouped = new Set(groups.flatMap(([, fields]) => fields));
  const examples = buildModelExamples(doc.model_id, doc.model_type, doc.params, { input, configId: doc.config_id, configRevision: doc.revision });
  const preview = modelOutputPreview(task?.result, doc.output_schema);
  return <div className="model-playground">
    <section className="docs-section"><h2>在线测试 · Input</h2>
      <Space wrap style={{ marginBottom: 16 }}><Select<number> aria-label="载入示例" placeholder="载入示例" disabled={busy || running} style={{ minWidth: 180 }} value={undefined} options={(doc.examples || []).map((e, i) => ({ label: e.name, value: i }))} onChange={i => change(doc.examples![i].input)} />
        <Button disabled={busy || running} onClick={() => change(defaults(doc))}>恢复默认输入</Button></Space>
      <fieldset disabled={busy || running} style={{ border: 0, padding: 0 }}>
        <Tabs items={[
          { key: 'form', label: 'Form', children: <>{groups.map(([name, names]) => <section key={name}><h3>{name}</h3>{ordered.filter(p => names.includes(p.name) && !advanced.has(p.name)).map(field)}</section>)}{ordered.filter(p => !advanced.has(p.name) && !grouped.has(p.name)).map(field)}{advanced.size > 0 && <Collapse items={[{ key: 'advanced', label: '高级设置', children: ordered.filter(p => advanced.has(p.name)).map(field) }]} />}</> },
          { key: 'json', label: 'JSON', children: <Input.TextArea aria-label="模型输入 JSON" rows={14} value={json} onChange={e => { setJson(e.target.value); try { const v: unknown = JSON.parse(e.target.value); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); setInput(v as Record<string, unknown>); setJsonError(''); } catch { setJsonError('请输入有效的 JSON 对象'); } }} /> },
          { key: 'curl', label: 'cURL', children: <pre style={{ overflow: 'auto' }}>{examples.curl}</pre> },
          { key: 'python', label: 'Python', children: <pre style={{ overflow: 'auto' }}>{examples.python}</pre> },
        ]} />
      </fieldset>
      {(jsonError || !validation.valid) && <Alert type="warning" message={jsonError || '请完善输入参数'} description={validation.errors.map(e => `${e.field}: ${e.message}`).join('；')} />}
      <p>运行将按账户实际计费。API Key 仅保留在当前页面内存。</p>
      {estimate && <p>预估费用：{Number(estimate.estimatedCost.toFixed(6))} credits（{estimate.unitPrice} × {estimate.estimatedUsage} {doc.public_pricing?.usage_measure === 'characters' ? '字符' : estimate.usageType === 'duration' ? '秒' : estimate.usageType === 'token' ? 'Token' : '次'}）。最终费用以实际用量和结算为准。</p>}
      {priceError && <Alert type="warning" message={priceError} />}
      <Input.Password aria-label="运行 API Key" autoComplete="off" placeholder="mh_…" value={apiKey} disabled={busy || running} onChange={e => setApiKey(e.target.value)} />
      <Space style={{ marginTop: 12 }}><Button type="primary" loading={busy} disabled={running || !!jsonError || !!priceError || !validation.valid || !apiKey.trim()} onClick={submit}>运行</Button>
        {task && <Button disabled={busy} onClick={() => setRetry(v => v + 1)}>刷新任务状态</Button>}
        {task && ['PENDING', 'SUBMITTED'].includes(task.status) && <Button onClick={async () => { try { await playgroundApi.cancel(taskKey.current, task.taskId); setRetry(v => v + 1); } catch { setError('当前任务无法取消，请刷新状态'); } }}>取消任务</Button>}
        {task && terminal.has(task.status) && <Button onClick={() => { setTask(undefined); setError(''); }}>开始新测试</Button>}
      </Space>
      {error && <Alert style={{ marginTop: 12 }} type="error" message={error} />}
    </section>
    <section className="docs-section"><h2>Output <Tag>{task?.status || 'Idle'}</Tag></h2>
      {task && <p>Task ID: <code>{task.taskId}</code></p>}
      {task?.error?.message && <Alert type="error" message={task.error.message} />}
      {task?.billing && <p>费用：{task.billing.actualCost ?? task.billing.estimatedCost ?? '—'} {task.billing.currency}</p>}
      <Tabs items={[{ key: 'preview', label: '预览', children: <NodeOutputPreview output={preview} /> }, { key: 'json', label: 'JSON', children: <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(task || {}, null, 2)}</pre> }]} />
    </section>
  </div>;
}
