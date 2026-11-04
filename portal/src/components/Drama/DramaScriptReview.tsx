import { useMemo, useState } from 'react';
import { Alert, Button, Collapse, Input, Tag } from 'antd';
import type { DramaPlan } from '../../services/drama-api';
import { downloadText, scriptToPlan } from '../../utils/drama';

export default function DramaScriptReview({ text, plan, apply }: { text: string; plan: DramaPlan; apply: (text: string) => void }) {
  const [source, setSource] = useState(text);
  const result = useMemo(() => { try { return { plan: scriptToPlan(source, plan), error: '' }; } catch (e) { return { plan: undefined, error: (e as Error).message }; } }, [source, plan]);
  const parsed = result.plan;
  const example = JSON.stringify({ title: '我的故事', story: '小雨收到一封信。', characters: [{ name: '小雨', description: '短发，米色风衣' }], scenes: [{ name: '咖啡馆', description: '雨后，窗边暖光' }], shots: [{ title: '收到信', description: '小雨坐在窗边拿起信封', narration: '这封信，让她想起一个人。', duration: 5, characters: ['小雨'], scene: '咖啡馆' }] }, null, 2);
  return <div className="drama-studio">
    <p>先检查故事、人物和镜头，再采用。编辑和检查不调用模型、不扣积分。</p>
    {result.error && <Alert type="warning" role="alert" message={result.error} />}
    {parsed && <section aria-label="剧本内容预览"><h3>{parsed.title}</h3><p>{parsed.story}</p><Tag>{parsed.shots.length} 个镜头 · {parsed.shots.reduce((n,s) => n+s.duration,0)} 秒</Tag><p>角色：{parsed.characters.map(c=>`${c.name}（${c.description}）`).join('；') || '尚未添加，下一步需要补全'}</p><ol>{parsed.shots.map(s=><li key={s.id}><strong>{s.title} · {s.duration} 秒</strong><p>画面：{s.description}</p><p>旁白：{s.narration || '无'}</p></li>)}</ol></section>}
    <Collapse defaultActiveKey={text ? [] : ['source']} items={[{ key:'source',label:'编辑或粘贴结构化剧本',children:<><p>角色和场景引用使用相同名称；每个镜头 2–15 秒，总长最多 180 秒。</p><Input.TextArea aria-label="结构化剧本 JSON" value={source} rows={12} maxLength={100000} onChange={e=>setSource(e.target.value)} /><Button onClick={()=>downloadText(example,'短剧结构示例.json','application/json')}>下载格式示例</Button></> }]} />
    <Alert type="info" message="采用后替换故事、角色与分镜，并清除选片和配乐引用；已有候选仍保留，需要重新确认制作阶段。" />
    <Button type="primary" disabled={!parsed} onClick={()=>apply(source)}>采用这版剧本</Button>
  </div>;
}
