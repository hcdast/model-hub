import DramaImage from './DramaImage';
import { useState } from 'react';
import { Button, Checkbox, Empty, InputNumber, Modal, Select, Tag, message } from 'antd';
import type { DramaPlan, DramaProject } from '../../services/drama-api';
import { guideMedia, type GuideMediaKind } from '../../../../src/short-drama/drama-guide';
import { missingBatch, patchShotGroup, shotStatus } from '../../../../src/short-drama/drama-workspace';

const labels = { selected: '已选用', working: '制作中', review: '待选片', missing: '待补齐' };
export default function DramaShotNavigator({project,kind,index,focus,generate,edit,disabled}: {
  project:DramaProject;kind:GuideMediaKind;index:number;focus:(index:number)=>void;
  generate:(ids:string[])=>void;edit:(plan:DramaPlan)=>void;disabled:boolean;
}) {
  const {plan,candidates}=project;
  const [filter,setFilter]=useState('all'),[checked,setChecked]=useState<string[]>([]),[batch,setBatch]=useState(false);
  const [characters,setCharacters]=useState<string[]>(),[scene,setScene]=useState<string>(),[duration,setDuration]=useState<number>();
  const scope=checked.filter(id=>plan.shots.some(s=>s.id===id));
  const media=guideMedia(plan,candidates,kind),ids=missingBatch(plan,candidates,kind,scope.length?scope:undefined);
  const rows=plan.shots.map((shot,i)=>({shot,index:i,status:shotStatus(plan,candidates,kind,shot.id)})).filter(r=>filter==='all'||r.status===filter);
  return <aside className="sd-shot-navigator" aria-label="镜头列表与批量操作">
    <div className="sd-actions"><strong>镜头 {plan.shots.length}</strong><span>已选 {media.selected.length} · 待选 {media.ready.length+media.review.length}</span></div>
    <Select aria-label="筛选镜头状态" value={filter} onChange={setFilter} options={[{value:'all',label:'全部镜头'},...Object.entries(labels).map(([value,label])=>({value,label}))]}/>
    <div className="sd-shot-list">{rows.map(({shot,index:i,status})=>{
      const image=candidates.find(c=>c.id===shot.image && c.kind==='image' && c.targetId===shot.id && c.status==='succeeded');
      return <div className={`sd-shot-list-row ${index===i?'active':''}`} key={shot.id}>
        <Checkbox aria-label={`勾选镜头 ${i+1}`} checked={scope.includes(shot.id)} disabled={disabled} onChange={e=>setChecked(prev=>e.target.checked?[...new Set([...prev,shot.id])]:prev.filter(id=>id!==shot.id))}/>
        <button type="button" aria-label={`编辑镜头 ${i+1} ${shot.title}`} aria-pressed={index===i} onClick={()=>focus(i)}>{image?.url?<DramaImage projectId={project.id} candidate={image} alt="" retryable={false}/>:<span className="sd-shot-no">{i+1}</span>}<span><strong>{i+1}. {shot.title || '未命名镜头'}</strong><small>{shot.duration} 秒 · {labels[status]}</small></span></button>
      </div>;
    })}{!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有此状态的镜头"/>}</div>
    <div className="sd-shot-batch"><Checkbox disabled={disabled || !rows.length} checked={!!rows.length && rows.every(r=>scope.includes(r.shot.id))} indeterminate={rows.some(r=>scope.includes(r.shot.id)) && !rows.every(r=>scope.includes(r.shot.id))} onChange={e=>setChecked(prev=>e.target.checked?[...new Set([...prev,...rows.map(r=>r.shot.id)])]:prev.filter(id=>!rows.some(r=>r.shot.id===id)))}>勾选当前列表</Checkbox>
      <span>{scope.length ? `已勾选 ${scope.length} 个镜头` : '未勾选时，补齐全部缺项'}{scope.length>0 && <Button size="small" type="text" onClick={()=>setChecked([])}>清空</Button>}</span>
      <Button disabled={disabled || !ids.length} onClick={()=>generate(ids)}>查看补齐 {ids.length} 项消耗</Button>
      {kind==='image' && <Button disabled={disabled || !scope.length} onClick={()=>{setCharacters(undefined);setScene(undefined);setDuration(undefined);setBatch(true);}}>批量设置已勾选镜头</Button>}
      <p className="sd-note">保留已有选片，跳过待选和制作中的镜头。每批最多 12 项。</p>
    </div>
    <Modal open={batch} title={`设置已勾选的 ${scope.length} 个镜头`} onCancel={()=>setBatch(false)} okText="应用到勾选镜头" okButtonProps={{disabled:disabled || !scope.length || characters===undefined && scene===undefined && duration===undefined}} onOk={()=>{
      try {const patch={...(characters!==undefined?{characterIds:characters}:{}),...(scene!==undefined?{sceneId:scene || undefined}:{}),...(duration!==undefined?{duration}: {})};edit(patchShotGroup(plan,scope,patch));setBatch(false);message.success('已更新勾选镜头，已有素材保留，请重新确认分镜');}catch(e){message.warning((e as Error).message);}
    }}><div className="drama-studio sd-batch-fields"><Tag>{scope.map(id=>plan.shots.findIndex(s=>s.id===id)+1).join('、')} 号镜头</Tag><p>只修改填写的项目。设定改变后需要复核已有画面和视频。</p><label>关联角色</label><Select aria-label="批量关联角色" mode="multiple" placeholder="保持不变" value={characters} onChange={setCharacters} options={plan.characters.map(r=>({value:r.id,label:r.name}))}/><label>场景</label><Select aria-label="批量场景" placeholder="保持不变" value={scene} onChange={setScene} options={[{value:'',label:'不关联场景'},...plan.scenes.map(r=>({value:r.id,label:r.name}))]}/><label>镜头时长（秒）</label><InputNumber aria-label="批量镜头时长" min={2} max={15} precision={0} placeholder="保持不变" value={duration} onChange={v=>setDuration(v ?? undefined)}/></div></Modal>
  </aside>;
}
