import { useEffect, useState, type ReactNode } from 'react';
import { Button, Empty, Select, Tabs } from 'antd';
import type { DramaProject } from '../../services/drama-api';
import DramaMedia from './DramaMedia';

export type AssemblyTab = 'shot'|'voice'|'captions'|'film';
export default function DramaAssemblyWorkspace({project,index,tab,setTab,focus,reorder,navigator,preview,previewSequence,clip,voice,captions,film,versions,disabled}: {
  project:DramaProject;index:number;tab:AssemblyTab;setTab:(tab:AssemblyTab)=>void;
  focus:(index:number)=>void;reorder:(index:number,delta:number)=>void;disabled:boolean;
  navigator:ReactNode;preview:ReactNode;previewSequence?:number;clip:ReactNode;voice:ReactNode;captions:ReactNode;film:ReactNode;versions:()=>void;
}) {
  const [mode,setMode]=useState<'shot'|'film'>('shot'),[version,setVersion]=useState<string>();
  useEffect(()=>setMode('shot'),[index,previewSequence]);
  const exports=project.candidates.filter(c=>c.kind==='export' && c.status==='succeeded' && c.url);
  const selected=exports.find(c=>c.id===version) || exports[exports.length-1];
  const total=project.plan.shots.reduce((sum,s)=>sum+s.duration,0);
  return <div className="sd-assembly" aria-label="成片编辑工作区">
    {navigator}
    <div className="sd-assembly-preview"><div className="sd-preview-switch"><Button aria-pressed={mode==='shot'} onClick={()=>setMode('shot')}>当前镜头</Button><Button aria-pressed={mode==='film'} onClick={()=>setMode('film')}>已导出成片 {exports.length}</Button></div>
      {mode==='shot'?preview:<section className="sd-film-preview"><p className="sd-note">历史成片独立保存，当前草稿修改不会同步到这里。确认效果后可导出新版本。</p>{selected?<><Select aria-label="预览成片版本" value={selected.id} onChange={setVersion} options={exports.map((c,i)=>({value:c.id,label:`成片版本 ${i+1}`}))}/><DramaMedia key={selected.id} projectId={project.id} candidate={selected}/><Button onClick={versions}>查看版本与下载</Button></>:<Empty description="还没有成片。检查当前选片后导出第一个版本。"/>}</section>}
      <p className="sd-note">{mode==='shot'?'镜头预览用于检查画面和字幕位置；最终混音及全片衔接以导出版本为准。':'正在播放历史导出文件。'}</p>
    </div>
    <aside className="sd-inspector" aria-label="成片属性设置"><Tabs activeKey={tab} onChange={value=>setTab(value as AssemblyTab)} items={[{key:'shot',label:'镜头剪辑',children:clip},{key:'voice',label:'旁白配音',children:voice},{key:'captions',label:'字幕',children:captions},{key:'film',label:'全片设置',children:film}]}/></aside>
    <section className="sd-edit-timeline" aria-label="镜头时间线"><div className="sd-timeline-head"><strong>镜头顺序 · {total} 秒</strong><span>点击切换 · 使用前移 / 后移调整顺序</span></div><div className="sd-edit-strip">{project.plan.shots.map((shot,i)=>{
      const image=project.candidates.find(c=>c.id===shot.image && c.kind==='image' && c.targetId===shot.id && c.status==='succeeded');
      const start=project.plan.shots.slice(0,i).reduce((sum,s)=>sum+s.duration,0);
      return <div key={shot.id} className={index===i?'active':''}><button type="button" aria-label={`预览镜头 ${i+1} ${shot.title}`} aria-pressed={index===i} onClick={()=>{focus(i);setMode('shot');}}>{image?.url?<img src={image.url} alt=""/>:<span>{i+1}</span>}<strong>{i+1}. {shot.title}</strong><small>{start}s — {start+shot.duration}s</small></button><div className="sd-timeline-reorder"><button aria-label={`镜头 ${i+1} 前移`} disabled={disabled || i===0} onClick={()=>reorder(i,-1)}>←</button><button aria-label={`镜头 ${i+1} 后移`} disabled={disabled || i===project.plan.shots.length-1} onClick={()=>reorder(i,1)}>→</button></div></div>;
    })}</div></section>
  </div>;
}
