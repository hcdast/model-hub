import { useState } from 'react';
import { Alert, Button, Empty, Modal, Segmented, Tag } from 'antd';
import type { DramaCandidate, DramaKind, DramaPlan } from '../../services/drama-api';
import { visualWarnings } from '../../../../src/short-drama/drama-visual';
import DramaMedia from './DramaMedia';

const status = { pending:'等待制作', running:'制作中', succeeded:'已完成', failed:'需要处理' };
export default function DramaCandidateBrowser({projectId,kind,list,chosen,disabled,select,cancel,retry,plan}: {
  projectId:string;kind:DramaKind;list:DramaCandidate[];chosen?:string;disabled:boolean;
  select:(candidate:DramaCandidate)=>void;cancel:(candidate:DramaCandidate)=>void;retry:()=>void;
  plan:DramaPlan;
}) {
  const [filter,setFilter]=useState('usable'),[preview,setPreview]=useState<DramaCandidate>();
  const [dimensions,setDimensions]=useState<Record<string,{width:number;height:number}>>({});
  const measure=(id:string,size:{width:number;height:number})=>{if(size.width>0&&size.height>0)setDimensions(prev=>prev[id]?.width===size.width&&prev[id]?.height===size.height?prev:{...prev,[id]:size});};
  const current=list.find(c=>c.id===chosen && c.status==='succeeded' && c.url);
  const active=list.filter(c=>c.status==='running'||c.status==='pending'),failed=list.filter(c=>c.status==='failed');
  const rows=filter==='usable'?list.filter(c=>c.status==='succeeded'):filter==='working'?active:failed;
  const media=(c:DramaCandidate)=>['voice','music'].includes(kind)?<DramaMedia projectId={projectId} candidate={c} audio/>:kind==='video'?<DramaMedia projectId={projectId} candidate={c} onDimensions={size=>measure(c.id,size)}/>:<img src={c.url} alt={c.id===chosen?'当前使用的画面':'候选画面'} onLoad={e=>measure(c.id,{width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>;
  const meta=(c:DramaCandidate)=><><p className="sd-note">{c.source==='upload'?'自有素材':c.source==='workflow'?'高级工作流结果':'制作候选'}{c.createdAt?` · ${new Date(c.createdAt).toLocaleString()}`:''}</p>{c.stale && <Alert type="warning" message="设定已有修改，请复核是否继续使用"/>}{c.references!==undefined && <p className="sd-note">参考图：{c.references.length?c.references.map(r=>r.name).join('、'):c.manualReferenceCount?`${c.manualReferenceCount} 张手动参考图`:'仅使用文字描述'}</p>}{c.archiveStatus==='failed' && <Tag color="warning">归档待重试</Tag>}</>;
  return <section className="sd-candidate-browser" aria-label="制作候选">
    <Segmented aria-label="候选范围" value={filter} onChange={value=>setFilter(String(value))} options={[{value:'usable',label:`可选 ${list.filter(c=>c.status==='succeeded').length}`},{value:'working',label:`制作中 ${active.length}`},{value:'failed',label:`失败记录 ${failed.length}`}]}/>
    {!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter==='usable'?'尚无已完成候选，可先制作或上传素材':filter==='working'?'没有正在制作的候选':'没有失败记录'}/>}
    <div className="sd-candidates">{rows.map(c=><article key={c.id} className={`sd-candidate ${c.id===chosen?'chosen':''}`}>
      <div className="sd-candidate-head"><strong>候选 {list.findIndex(item=>item.id===c.id)+1}</strong><Tag>{c.id===chosen?'当前使用':status[c.status]}</Tag></div>
      {c.url && media(c)}{dimensions[c.id] && <p className="sd-note">实际尺寸 {dimensions[c.id].width} × {dimensions[c.id].height}{['image','video'].includes(kind) && ` · ${visualWarnings(plan,{shotId:c.targetId,candidateId:c.id,kind:kind as 'image'|'video',...dimensions[c.id]}).join('；') || '画幅与输出尺寸匹配'}`}</p>}{meta(c)}
      {c.status==='succeeded' && <div className="sd-actions"><Button size="small" onClick={()=>setPreview(c)}>{current && current.id!==c.id?'与当前对比':'放大预览'}</Button><Button size="small" disabled={disabled || c.id===chosen} onClick={()=>select(c)}>{c.id===chosen?'当前使用':'设为当前'}</Button></div>}
      {c.error && <details><summary>查看失败原因</summary><p>{c.error}</p></details>}
      {(c.status==='pending'||c.status==='running') && c.taskId && <Button size="small" disabled={disabled} onClick={()=>cancel(c)}>取消这一项</Button>}
    </article>)}</div>
    {filter==='failed' && !!failed.length && <Button disabled={disabled || !!current || !!active.length || list.some(c=>c.status==='succeeded'&&!c.stale&&c.url)} onClick={retry}>查看仅补做此项的消耗</Button>}
    <Modal centered styles={{body:{maxHeight:'calc(100dvh - 180px)',overflowY:'auto'}}} open={!!preview} title={current && preview?.id!==current.id?'对比候选与当前选片':'预览当前候选'} width={920} onCancel={()=>setPreview(undefined)} footer={<><Button onClick={()=>setPreview(undefined)}>返回候选</Button>{preview && <Button type="primary" disabled={disabled || preview.id===chosen} onClick={()=>{select(preview);setPreview(undefined);}}>{preview.id===chosen?'当前正在使用':'设为当前，保留旧候选'}</Button>}</>} destroyOnClose><div className="drama-studio sd-compare-grid">{current && current.id!==preview?.id && <section><h3>当前使用</h3>{media(current)}{meta(current)}</section>}{preview && <section><h3>{current?.id===preview.id?'当前使用':'新候选'}</h3>{media(preview)}{meta(preview)}</section>}</div></Modal>
  </section>;
}
