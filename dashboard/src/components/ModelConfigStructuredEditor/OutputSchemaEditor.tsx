import { useState } from 'react';
import { Button, Card, Input, InputNumber, Select, Space, Switch, Typography, message } from 'antd';

/** Edits the same output contract as the advanced JSON field, preserving unedited constraints. */
export function OutputSchemaEditor({ value, onChange, name = 'result', depth = 0 }: { value: any; onChange: (value: any) => void; name?: string; depth?: number }) {
  const [field, setField] = useState('');
  const definition = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!definition) return <Button onClick={() => onChange({ type: 'object', properties: {} })}>定义输出结构</Button>;
  const patch = (update: any) => onChange({ ...definition, ...update });
  const properties = definition.properties || {};
  return <Card size="small" title={name} extra={depth === 0 ? <Button size="small" onClick={() => onChange(null)}>清除输出定义</Button> : undefined}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap><Typography.Text>类型</Typography.Text><Select value={definition.type} style={{ width: 130 }} options={['string', 'number', 'integer', 'boolean', 'array', 'object'].map(value => ({ value }))} onChange={type => {
        const next = { ...definition, type }; delete next.properties; delete next.items; delete next.media;
        if (type === 'array') next.items = { type: 'string' };
        if (type === 'object') next.properties = {};
        onChange(next);
      }} /><Typography.Text>必填</Typography.Text><Switch checked={definition.required === true} onChange={required => patch({ required })} /></Space>
      <Input placeholder="输出说明" value={definition.description} onChange={e => patch({ description: e.target.value })} />
      {definition.type === 'string' && <Space wrap><Typography.Text>媒体</Typography.Text><Select allowClear placeholder="普通文本" style={{ width: 150 }} value={definition.media?.kind} options={['image', 'video', 'audio'].map(value => ({ value }))} onChange={kind => patch({ media: kind ? { ...definition.media, kind } : undefined })} /></Space>}
      {definition.type === 'array' && <><Space wrap><Typography.Text>最少项数</Typography.Text><InputNumber min={0} precision={0} value={definition.minItems} onChange={minItems => patch({ minItems: minItems ?? undefined })} /><Typography.Text>最多项数</Typography.Text><InputNumber min={0} precision={0} value={definition.maxItems} onChange={maxItems => patch({ maxItems: maxItems ?? undefined })} /></Space>{depth < 6 && <OutputSchemaEditor name={`${name}[]`} depth={depth + 1} value={definition.items || { type: 'string' }} onChange={items => patch({ items })} />}</>}
      {definition.type === 'object' && depth < 6 && <>
        {Object.entries(properties).map(([key, child]) => <Space direction="vertical" style={{ width: '100%' }} key={key}><OutputSchemaEditor name={key} depth={depth + 1} value={child} onChange={next => patch({ properties: { ...properties, [key]: next } })} /><Button danger size="small" onClick={() => { const next = { ...properties }; delete next[key]; patch({ properties: next }); }}>删除字段 {key}</Button></Space>)}
        <Space><Input placeholder="新输出字段名" value={field} onChange={e => setField(e.target.value)} /><Button disabled={!field.trim()} onClick={() => {
          const key = field.trim(); if (Object.prototype.hasOwnProperty.call(properties, key) || ['__proto__', 'prototype', 'constructor'].includes(key)) { message.error('字段名重复或不可使用'); return; }
          patch({ properties: { ...properties, [key]: { type: 'string' } } }); setField('');
        }}>添加输出字段</Button></Space>
      </>}
      {depth >= 6 && <Typography.Text type="secondary">更深层结构请使用高级 JSON 编辑。</Typography.Text>}
    </Space>
  </Card>;
}
