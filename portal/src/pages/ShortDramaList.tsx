import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Input, Modal, Pagination, Select, Spin, Tag, message } from 'antd';
import { ArrowRightOutlined, PlaySquareOutlined, PlusOutlined } from '@ant-design/icons';
import { dramaApi, type DramaProject } from '../services/drama-api';
import { useAuthStore, getApiErrorMessage } from '../store/auth-store';
import { DRAMA_STEPS, exampleDrama, emptyDramaPlan } from '../utils/drama';
import { dramaGuide } from '../../../src/short-drama/drama-guide';
import { resumeStep } from '../../../src/short-drama/drama-workspace';
import './ShortDramaStudio.css';

export default function ShortDramaList({ mode = 'library' }: { mode?: 'library' | 'create' }) {
  const [params] = useSearchParams();
  const navigate = useNavigate(), authenticated = useAuthStore(s => s.isAuthenticated);
  const [items, setItems] = useState<DramaProject[]>([]), [loading, setLoading] = useState(false), [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false), [search, setSearch] = useState(params.get('search') || '');
  const [error, setError] = useState(''), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const load = async () => { if (!authenticated || mode === 'create') { setItems([]); setTotal(0); return; } setLoading(true); setError(''); try { const r = await dramaApi.list(page, archived, search); setItems(r.items); setTotal(r.total); } catch (e) { setError(getApiErrorMessage(e, '作品加载失败')); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [page, authenticated, archived, search, mode]);
  const create = async (example = false) => {
    if (!authenticated) { navigate('/login', { state: { from: { pathname: '/create' } } }); return; }
    setCreating(true); try { const p = await dramaApi.create({ ...(example ? exampleDrama() : emptyDramaPlan()), production: { provider: 'akool-maas', models: {} } }); navigate(`/short-dramas/${p.id}`); } catch (e) { message.error(getApiErrorMessage(e, '创建失败，请重试')); } finally { setCreating(false); }
  };
  return <div className="drama-studio sd-library">
    {mode === 'create' && <><div className="sd-library-hero"><div><span className="sd-eyebrow"><PlaySquareOutlined aria-hidden="true" /> 短剧工作台</span><h1>把一个灵感，拍成你的故事。</h1><p>写故事、定角色、看分镜、做视频、出成片。每一步都有指引。</p><div className="sd-actions"><Button type="primary" size="large" icon={<PlusOutlined aria-hidden="true" />} loading={creating} onClick={() => void create()}>开始我的第一部短剧</Button><Button size="large" onClick={() => void create(true)} loading={creating}>用示例故事试试 <ArrowRightOutlined aria-hidden="true" /></Button></div></div><img src="/drama/cafe.jpg" alt="来自明天的照片：绘本风格示例" /></div>
    <div className="sd-library-steps">{DRAMA_STEPS.map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div></>}
    {mode === 'library' && <>
    <div className="sd-section-head"><div><h2>我的作品</h2><p>已保存的故事、素材和镜头候选，随时回来继续。</p></div><Button icon={<PlusOutlined aria-hidden="true" />} loading={creating} onClick={() => void create()}>新建短剧</Button></div>
    <div className="sd-actions"><Input.Search defaultValue={search} aria-label="搜索作品" placeholder="搜索作品名称" allowClear onSearch={value => { setPage(1); setSearch(value); }} style={{maxWidth:360}} /><Select aria-label="作品范围" value={archived ? 'archived' : 'active'} options={[{value:'active',label:'制作中的作品'},{value:'archived',label:'已归档作品'}]} onChange={value => {setArchived(value === 'archived');setPage(1);}} /></div>{error && <Alert type="error" message={error} action={<Button onClick={() => void load()}>重试</Button>} showIcon />}
    {loading ? <div className="sd-loading"><Spin /></div> : items.length ? <div className="sd-works-grid">{items.map(p => { const running = p.candidates?.filter(c => ['pending','running'].includes(c.status)).length || 0; const exports = p.candidates?.filter(c => c.kind === 'export' && c.status === 'succeeded').length || 0; const guide=dramaGuide(p); const action=guide.next.action; const voice='voice' in action && action.voice || 'kind' in action && action.kind==='voice'; const cover = p.candidates?.find(c => c.id === p.plan.shots[0]?.image)?.url; return <article key={p.id} className="sd-work-card"><Link to={`/short-dramas/${p.id}?step=${resumeStep(p)}${voice?'&tab=voice':''}`}><div className="sd-work-cover">{cover ? <img src={cover} alt={p.plan.title} style={{width:'100%',height:160,objectFit:'cover'}} /> : <PlaySquareOutlined aria-hidden="true" />}<span>{p.plan.style}</span></div><div className="sd-shot-copy"><strong>{p.plan.title}</strong><p>{p.plan.shots.length} 个镜头 · {guide.next.title}</p><Tag>{running ? `${running} 项制作中` : exports ? `${exports} 个成片版本` : '草稿'}</Tag><p>已用 {p.budget?.used || 0} 积分 · 预留 {p.budget?.reserved || 0}</p><small>{p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '刚刚创建'}</small></div></Link><div className="sd-actions"><Button size="small" onClick={() => { void dramaApi.copy(p.id).then(c => navigate(`/short-dramas/${c.id}`)).catch(e => message.error(getApiErrorMessage(e,'复制失败'))); }}>复制故事与分镜</Button><Button size="small" onClick={() => Modal.confirm({title:archived ? '恢复作品？' : '归档作品？',content:'素材和历史成片保留；已提交任务仍继续跟踪结算。',onOk:async()=>{await dramaApi.archive(p.id,p.revision,!archived);await load();}})}>{archived ? '恢复' : '归档'}</Button></div></article>; })}</div> : <Empty description={authenticated ? '还没有匹配的作品，试试新建短剧或调整搜索条件' : '登录后查看并继续你的短剧作品'}><Link to="/create"><Button type="primary">开始创作</Button></Link><Link to="/discover?type=short-drama"><Button>发现短剧模板</Button></Link></Empty>}
    {total > 24 && <Pagination current={page} pageSize={24} total={total} onChange={setPage} showSizeChanger={false} />}
    </>}
    {mode === 'create' && <p className="sd-note">示例提供故事与分镜文字，不包含已生成的视频。实际制作会先显示模型、范围和预估积分，确认后才开始。</p>}
  </div>;
}
