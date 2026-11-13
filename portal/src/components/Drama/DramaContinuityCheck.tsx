import DramaImage from './DramaImage';
import { useState } from 'react';
import { Button, Collapse, Empty, Segmented, Tag } from 'antd';
import type { DramaProject } from '../../services/drama-api';
import { continuityRows } from '../../../../src/short-drama/drama-continuity';

export default function DramaContinuityCheck({ project, disabled, locate, role }: {
  project: DramaProject; disabled: boolean;
  locate: (index: number, kind: 'image' | 'video') => void;
  role: (kind: 'character' | 'scene', id: string) => void;
}) {
  const rows = continuityRows(project.plan, project.candidates);
  const attention = rows.filter(r => r.missing.length || r.stale.length).length;
  const [filter,setFilter]=useState(attention?'attention':'all'),[selected,setSelected]=useState<string>();
  const visible=rows.filter(r=>filter==='all' || r.missing.length || r.stale.length);
  const focused=visible.find(r=>r.shot.id===selected) || visible[0];
  const legacy=rows.some(r=>[r.image,r.video].some(c=>c && c.source!=='upload' && c.references===undefined));
  return <section className="sd-continuity" aria-label="角色与场景连续性"><Collapse defaultActiveKey={['continuity']} items={[{
    key: 'continuity', label: `角色与场景连续性 · ${attention ? `${attention} 个镜头待复核` : `${rows.length} 个镜头可检查`}`,
    children: <><p className="sd-note">先选好角色和场景参考图，再制作关联镜头。这里核对素材绑定和设定变化；人物长相、服装和动作是否连续，仍需预览后判断。更换参考图会提示复核，已有选片保留。</p>
      {legacy && <p className="sd-note">部分历史候选未记录制作时的参考图，需人工预览核对；这不代表制作失败。</p>}
      <Segmented aria-label="连续性检查范围" value={filter} onChange={v=>setFilter(String(v))} options={[{value:'attention',label:`待复核 ${attention}`},{value:'all',label:`全部 ${rows.length}`}]}/>
      <div className="sd-continuity-selector">{visible.map(r=><Button size="small" key={r.shot.id} aria-pressed={focused?.shot.id===r.shot.id} onClick={()=>setSelected(r.shot.id)}>{r.index+1}. {r.shot.title}</Button>)}</div>
      {!visible.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={rows.length?'暂无设定变化或缺失参考图；视觉一致性仍需预览判断':'添加分镜并关联角色和场景后，在这里检查连续性'} />}
      <div className="sd-continuity-grid">{(focused?[focused]:[]).map(({shot,index,references,missing,image,video,stale})=><article className="sd-panel" key={shot.id}>
        <div className="sd-actions"><strong>{index+1}. {shot.title || '未命名镜头'}</strong>{stale.length>0 && <Tag color="warning">设定已更新，复核选片</Tag>}</div>
        <div className="sd-continuity-references">{references.map(ref=>{
          const c=project.candidates.find(item=>item.id===ref.candidateId && item.kind===ref.kind && item.targetId===ref.targetId);
          return <button key={`${ref.kind}-${ref.targetId}`} disabled={disabled} onClick={()=>role(ref.kind as 'character'|'scene',ref.targetId)}>{c?.url && <DramaImage projectId={project.id} candidate={c} alt={`${ref.name}参考图`} retryable={false}/>}<span>{ref.kind==='character'?'角色':'场景'} · {ref.name}</span></button>;
        })}</div>
        {!shot.characterIds.length && <p className="sd-note">未关联角色；空镜可保持不关联。</p>}
        {!shot.sceneId && <p className="sd-note">未关联场景，环境仅按镜头描述制作。</p>}
        {missing.length>0 && <p className="sd-error-text">尚未选参考图：{missing.join('、')}。可到设定页补充，或在报价时确认仅使用文字描述。</p>}
        <div className="sd-continuity-pair">{(['image','video'] as const).map(kind=>{
          const selected=kind==='image'?image:video;
          return <div key={kind}><Button disabled={disabled} onClick={()=>locate(index,kind)}>检查镜头{kind==='image'?'画面':'视频'}</Button>
            <p>{selected ? selected.stale?'已有选片 · 设定已更新':'已有选片' : '尚未选片'}</p>
            {kind==='image' && selected?.url && <DramaImage projectId={project.id} candidate={selected} alt={`镜头 ${index+1} 已选画面`}/>}
            {selected && <p className="sd-note">{selected.source==='upload'?'自有素材，请人工检查一致性':selected.references===undefined?'历史参考记录不完整':selected.references.length?`制作时使用：${selected.references.map(r=>r.name).join('、')}`:selected.manualReferenceCount ? '制作时使用 '+selected.manualReferenceCount+' 张手动参考图' : '制作时未传入参考图，仅使用文字描述'}</p>}
          </div>;
        })}</div>
      </article>)}</div></>,
  }]}/></section>;
}
