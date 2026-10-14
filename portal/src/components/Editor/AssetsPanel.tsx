import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, List, Pagination, Popconfirm, Progress, Space, Spin, Typography } from 'antd';
import { isAxiosError } from 'axios';
import { workflowAssetsApi, type WorkflowAsset } from '../../services/workflow-assets-api';

interface AssetsPanelProps {
  open: boolean;
  nodeId?: string;
  onClose: () => void;
  onSelect: (asset: WorkflowAsset) => void;
}
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,text/plain,application/json';
function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join('；');
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : '素材请求失败，请重试';
}

export function AssetsPanel({ open, nodeId, onClose, onSelect }: AssetsPanelProps) {
  const [items, setItems] = useState<WorkflowAsset[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    workflowAssetsApi.list(page).then(response => {
      if (!active) return;
      setItems(response.data.items);
      setTotal(response.data.total);
    }).catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, page, refresh]);

  const upload = async (file?: File) => {
    if (!file || uploading) return;
    setError('');
    const mime = file.type || (file.name.toLowerCase().endsWith('.json') ? 'application/json' : file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : '');
    if (!ACCEPT.split(',').includes(mime)) { setError('不支持此类型，请选择提示中列出的媒体或 UTF-8 文本文件'); return; }
    const max = ['text/plain', 'application/json'].includes(mime) ? 1024 * 1024 : 20 * 1024 * 1024;
    if (!file.size || file.size > max) { setError('文件不能为空；媒体最大 20 MiB，文本/JSON 最大 1 MiB'); return; }
    setUploading(true);
    setProgress(0);
    try {
      await workflowAssetsApi.upload(file.type ? file : new File([file], file.name, { type: mime }), setProgress);
      setPage(1);
      setRefresh(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setUploading(false); }
  };
  const remove = async (asset: WorkflowAsset) => {
    setDeleting(asset.id);
    setError('');
    try {
      await workflowAssetsApi.delete(asset.id);
      if (items.length === 1 && page > 1) setPage(page - 1);
      else setRefresh(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setDeleting(undefined); }
  };

  return <Drawer title={nodeId ? '为当前节点选择素材' : '我的素材库'} open={open} onClose={onClose} width={480}>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary">支持 PNG/JPEG/WebP/GIF、MP4/WebM、MP3/WAV/OGG（20 MiB 内）以及 UTF-8 TXT/JSON（1 MiB 内）。素材链接会传给所选模型供应商，请勿上传敏感内容。</Typography.Paragraph>
      <Alert type="info" showIcon message="输出素材保存原始资源链接，供应商链接可能过期。删除仅移除素材库记录，不撤销工作流中已引用的链接。" />
      <input ref={inputRef} hidden type="file" accept={ACCEPT} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      <Space><Button type="primary" loading={uploading} onClick={() => inputRef.current?.click()}>上传素材</Button><Button disabled={loading || uploading} onClick={() => setRefresh(value => value + 1)}>刷新</Button></Space>
      {uploading && <Progress percent={progress} status="active" format={value => value === 100 ? '存储处理中' : `${value}%`} />}
      {error && <Alert type="error" showIcon message={error} />}
      <Spin spinning={loading}>
        <List dataSource={items} locale={{ emptyText: <Empty description="暂无素材，请上传或从节点成功输出保存" /> }} renderItem={asset => <List.Item key={asset.id} actions={[
          <Button key="select" disabled={uploading || !!deleting} onClick={() => onSelect(asset)}>选择</Button>,
          <Popconfirm key="delete" title="从素材库删除？" description="不会撤销存储链接或其他节点中的引用。" onConfirm={() => remove(asset)}><Button danger loading={deleting === asset.id} disabled={!!deleting && deleting !== asset.id}>删除</Button></Popconfirm>,
        ]}>
          <List.Item.Meta title={<Typography.Text style={{ maxWidth: 190 }} ellipsis={{ tooltip: asset.name }}>{asset.name}</Typography.Text>} description={<Space direction="vertical"><span>{asset.kind}{asset.size ? ` · ${(asset.size / 1024).toFixed(1)} KiB` : ''}{asset.source === 'output-reference' ? ' · 原始输出链接' : ''}</span><a href={asset.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开原始素材</a>{asset.text && <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ maxWidth: 190, margin: 0 }}>{asset.text}</Typography.Paragraph>}</Space>} />
        </List.Item>} />
      </Spin>
      <Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={setPage} disabled={loading || uploading || !!deleting} />
    </Space>
  </Drawer>;
}

export default AssetsPanel;
