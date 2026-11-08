import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Slider, message } from 'antd';
import type { DramaCaption, DramaShot, DramaCandidate } from '../../../../src/short-drama/drama.types';
import { captionsStale, estimateCaptions, shotCaptions, type CaptionAnalysis } from '../../../../src/short-drama/drama-captions';
import { useAuthStore } from '../../store/auth-store';
import { captionDraftKey,readCaptionDraft } from '../../utils/drama-caption-drafts';
import DramaMedia from './DramaMedia';

export default function DramaCaptionEditor({projectId,shot,voice, apply, analyze, onDirty,previewTime,onSeek,onDraftPreview}: {projectId:string;shot:DramaShot;voice?:DramaCandidate;apply:(cues:DramaCaption[],source:DramaShot,method:'estimated'|'pause'|'manual')=>boolean|void;analyze:()=>Promise<CaptionAnalysis>;onDirty?:(dirty:boolean)=>void;previewTime?:number;onSeek?:(time:number)=>void;onDraftPreview?:(cues:DramaCaption[])=>void}) {
  const owner=useAuthStore(s=>s.user?.id),storageKey=captionDraftKey(owner,projectId,shot.id);
  const [recovered]=useState(()=>readCaptionDraft(storageKey));
  const [draft,setDraft]=useState<DramaCaption[]>(recovered || shotCaptions(shot)),[dirty,setDirty]=useState(!!recovered),[busy,setBusy]=useState(false),[error,setError]=useState(''),[time,setTime]=useState(0);
  const previousCaptions=useRef(JSON.stringify(shot.captions));
  const previewCallback=useRef(onDraftPreview);previewCallback.current=onDraftPreview;
  useEffect(()=>{previewCallback.current?.(draft);},[draft]);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(previousCaptions.current===JSON.stringify(shot.captions))return;previousCaptions.current=JSON.stringify(shot.captions);setDraft(shotCaptions(shot));setDirty(false);setError('');},[shot]);
  useEffect(()=>{try {if(dirty)localStorage.setItem(storageKey,JSON.stringify(draft));else localStorage.removeItem(storageKey);}catch{/* The unsaved notice remains visible. */}},[draft,dirty,storageKey]);
  useEffect(()=>{onDirty?.(dirty);},[dirty,onDirty]);
  useEffect(()=>{if(!dirty)return; const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const save=(cues:DramaCaption[],method:'estimated'|'pause'|'manual',source=shot)=>{
    let end=0;
    for(const cue of cues) {
      if(!cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start<end || cue.start<0 || cue.end>source.duration || cue.end-cue.start<0.03) {setError('每段需有文字，时间按顺序排列且不重叠，位于镜头内（每段至少 0.03 秒）。');return;}
      end=cue.end;
    }
    if(apply(cues,source,method)===false) {setError('镜头已有更新，本次字幕未应用，请重新检查。');return false;}
    setDirty(false);setError('');return true;
  };
  const update=(index:number,patch:Partial<DramaCaption>)=>{setDraft(prev=>prev.map((c,i)=>i===index?{...c,...patch}:c));setDirty(true);};
  const automatic=async(useAudio:boolean)=>{
    setBusy(true);setError('');const source=shot;
    try {const analysis=useAudio ? await analyze() : undefined;if(!alive.current)return;if(analysis?.error)throw new Error(analysis.error);const cues=estimateCaptions(source,analysis);if(save(cues,useAudio?'pause':'estimated',source))message.info('已生成分句字幕，请试听并校正。自动时间为估计值。');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const position=previewTime ?? time;
  const seek=(seconds:number)=>{setTime(seconds);onSeek?.(seconds);};
  const visible=draft.find(c=>position>=c.start && position<c.end);
  return <section className="sd-caption-editor" aria-label="分句字幕校正"><h3>分句字幕与时间校正</h3><p className="sd-note">按句拆分，避免长段文字遮挡画面。停顿辅助会读取真实旁白，不调用生成模型、不扣积分；根据音量停顿和文字长度估时，不是逐字识别。</p>
    {captionsStale(shot) && <Alert type="warning" message="旁白文字或音频已修改，字幕需要重新对齐或手动确认后才能导出。" />}
    <div className="sd-actions"><Button loading={busy} disabled={!shot.narration.trim() || dirty} onClick={()=>void automatic(false)}>按文字分句（估时）</Button><Button loading={busy} disabled={!shot.voice || dirty} onClick={()=>void automatic(true)}>按旁白停顿辅助对齐</Button></div>
    {error && <Alert type="error" message={error} />}{dirty && <Alert type="info" message="字幕修改尚未应用，已尝试在本机暂存，回到该镜头可继续。应用后才参与下载和导出。" />}
    {draft.map((cue,i)=><div className={`sd-caption-row ${visible===cue?'active':''}`} key={i}><Button size="small" aria-label={`预览第 ${i+1} 段字幕`} onClick={()=>seek(cue.start)}>第 {i+1} 段 ▶</Button><details><summary>时间 {cue.start.toFixed(2)} — {cue.end.toFixed(2)} 秒</summary><InputNumber aria-label={`第 ${i+1} 段字幕开始`} min={0} max={shot.duration} step={0.05} value={cue.start} onChange={v=>update(i,{start:v ?? 0})}/><span>至</span><InputNumber aria-label={`第 ${i+1} 段字幕结束`} min={0} max={shot.duration} step={0.05} value={cue.end} onChange={v=>update(i,{end:v ?? 0})}/></details><Input.TextArea aria-label={`第 ${i+1} 段字幕文字`} rows={2} maxLength={2000} value={cue.text} onChange={e=>update(i,{text:e.target.value})}/><Button size="small" onClick={()=>{setDraft(prev=>prev.filter((_,n)=>n!==i));setDirty(true);}}>移除此段</Button></div>)}
    <div className="sd-actions"><Button type="primary" disabled={!dirty && !captionsStale(shot)} onClick={()=>save(draft,'manual')}>应用本镜头字幕校正</Button><Button disabled={!dirty} onClick={()=>{setDraft(shotCaptions(shot));setDirty(false);setError('');}}>放弃未应用修改</Button></div>
    {voice && <DramaMedia projectId={projectId} candidate={voice} audio onTimeUpdate={seconds=>seek(Math.min(shot.duration,seconds))}/>}
    <label>字幕预览位置 · {position.toFixed(2)} 秒</label><Slider aria-label="字幕预览位置" min={0} max={shot.duration} step={0.05} value={position} onChange={seek}/><div className="sd-caption-preview" aria-live="polite">{visible?.text || '此处无字幕'}</div><p className="sd-note">点击字幕段或拖动滑条可定位中央镜头预览；未应用的文字仅供预览。应用后才参与 SRT 和新成片，旁白原文与配音不变。</p>
  </section>;
}
