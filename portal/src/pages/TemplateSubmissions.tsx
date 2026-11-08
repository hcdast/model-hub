import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Empty, Pagination, Skeleton, Tag } from 'antd';
import { creationApi, TemplateSubmission } from '../services/creation-api';
import { useAuthStore } from '../store/auth-store';

const statuses: Record<string, string> = { pending: '待审核', published: '已发布', rejected: '未通过', withdrawn: '已下架' };
export default function TemplateSubmissions() {
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const [items, setItems] = useState<TemplateSubmission[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!authenticated) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true); setError(false);
    void creationApi.submissions(page).then(data => { if (active) { setItems(data.items); setTotal(data.total); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authenticated, page, revision]);
  if (loading) return <Skeleton active />;
  if (error) return <Alert type="error" message="投稿加载失败" action={<Button onClick={() => setRevision(v => v + 1)}>重试</Button>} />;
  return <><p>在作品或工作流中选择「提交为模板」。审核发布后，其他人可以从发现页创建自己的副本。</p>
    {!items.length ? <Empty description={authenticated ? '还没有模板投稿' : '登录后查看你的模板投稿'} /> : <div className="creation-options">{items.map(item => <section key={item._id}><Tag color={item.status === 'published' ? 'green' : undefined}>{statuses[item.status] || item.status}</Tag><h2>{item.name}</h2><p>{item.description}</p>{item.reviewNote && <Alert message={item.reviewNote} />}
      <Link to={item.kind === 'workflow' ? `/workflows/${item.sourceId}` : `/short-dramas/${item.sourceId}`}><Button>返回源作品</Button></Link>
      {item.status === 'published' && <Link to={item.kind === 'workflow' ? `/templates/${item._id}` : `/drama-templates/${item._id}`}><Button>查看已发布模板</Button></Link>}
    </section>)}</div>}
    {total > 20 && <Pagination current={page} total={total} pageSize={20} showSizeChanger={false} onChange={setPage} />}
  </>;
}
