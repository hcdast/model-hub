import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Drawer, Empty, Input, InputNumber, Modal, Select, Slider, Spin, Tag, message } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, AudioOutlined, CheckOutlined, CloudUploadOutlined, DownloadOutlined, FolderOpenOutlined, LinkOutlined, PictureOutlined, PlayCircleOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined, SaveOutlined, VideoCameraOutlined } from '@ant-design/icons';
import TemplateSubmissionButton from '../components/Templates/TemplateSubmissionButton';
import ShotWorkflowButton from '../components/Drama/ShotWorkflowButton';
import StageTemplateButton from '../components/Drama/StageTemplateButton';
import BrandIcon from '../components/BrandIcon';
import NotificationBell from '../components/Layout/NotificationBell';
import DramaScriptReview from '../components/Drama/DramaScriptReview';
import DramaMedia from '../components/Drama/DramaMedia';
import DramaImage from '../components/Drama/DramaImage';
import DramaTimingCheck from '../components/Drama/DramaTimingCheck';
import DramaCaptionEditor from '../components/Drama/DramaCaptionEditor';
import DramaVisualCheck from '../components/Drama/DramaVisualCheck';
import DramaContinuityCheck from '../components/Drama/DramaContinuityCheck';
import { shotCaptions, captionsStale } from '../../../src/short-drama/drama-captions';
import { type DramaVisualReport } from '../../../src/short-drama/drama-visual';
import { fitVoiceTiming, voiceOverflows, type DramaTimingReport } from '../../../src/short-drama/drama-timing';
import DramaProductionPanel from '../components/Drama/DramaProductionPanel';
import DramaCreationGuide from '../components/Drama/DramaCreationGuide';
import DramaShotNavigator from '../components/Drama/DramaShotNavigator';
import DramaCandidateBrowser from '../components/Drama/DramaCandidateBrowser';
import DramaAssemblyWorkspace, { type AssemblyTab } from '../components/Drama/DramaAssemblyWorkspace';
import DramaVersionStatus from '../components/Drama/DramaVersionStatus';
import { missingBatch } from '../../../src/short-drama/drama-workspace';
import { dramaGuide, guideMedia, type GuideAction } from '../../../src/short-drama/drama-guide';
import { roleInputs, voiceBatchTargets } from '../../../src/short-drama/drama-production';
import DramaGenerationModal, { type GenerationRequest } from '../components/Drama/DramaGenerationModal';
import { useDramaProject } from '../hooks/useDramaProject';
import { dramaApi, type DramaCandidate, type DramaKind, type DramaModel, type DramaPlan, type DramaCapabilities } from '../services/drama-api';
import { workflowAssetsApi, type WorkflowAsset } from '../services/workflow-assets-api';
import { getApiErrorMessage, useAuthStore } from '../store/auth-store';
import { captionDraftKey,readCaptionDraft } from '../utils/drama-caption-drafts';
import { candidateFor, targetCandidates, DRAMA_STEPS, DRAMA_STYLES, dramaId, downloadText, exampleDrama, planSrt } from '../utils/drama';
import './ShortDramaStudio.css';
import '../components/Drama/DramaWorkspace.css';
import { projectEvent } from '../services/creation-events';

type AssetRequest = { kind: DramaKind; targetId: string };
const isActive = (c: DramaCandidate) => c.status === 'pending' || c.status === 'running';
const kindMedia = (kind: DramaKind) => ['voice', 'music'].includes(kind) ? 'audio' : kind === 'video' ? 'video' : 'image';
const statusText = { pending: '等待制作', running: '制作中', succeeded: '已完成', failed: '需要处理' };

export default function ShortDramaStudio() {
  const captionOwner=useAuthStore(s=>s.user?.id);
  const { id } = useParams(), navigate = useNavigate();
  const [entryParams] = useSearchParams();
  const focusedEntry = useRef('');
  const { project, loading, error, saveState, edit, flush, refresh, load, mutate, recovery, recover, discardRecovery } = useDramaProject(id);
  const [shotIndex, setShotIndex] = useState(0), [, setPage] = useState(0), [castIndex, setCastIndex] = useState(0);
  const [castTab, setCastTab] = useState<'characters' | 'scenes' | 'voice'>('characters');
  const [models, setModels] = useState<DramaModel[]>([]), [generation, setGeneration] = useState<GenerationRequest>();
  const [modelReload, setModelReload] = useState(0);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false), [help, setHelp] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<DramaCapabilities>();
  const [assetRequest, setAssetRequest] = useState<AssetRequest>(), [assetItems, setAssetItems] = useState<WorkflowAsset[]>([]), [assetLoading, setAssetLoading] = useState(false);
  const [assetPage, setAssetPage] = useState(1), [assetTotal, setAssetTotal] = useState(0), [uploading, setUploading] = useState(false);
  const [previewScript, setPreviewScript] = useState<DramaCandidate>(), [importingScript, setImportingScript] = useState(false);
  const [timing, setTiming] = useState<DramaTimingReport>(), [timingBusy, setTimingBusy] = useState(false), [timingError, setTimingError] = useState('');
  const [visual,setVisual]=useState<DramaVisualReport>(),[visualBusy,setVisualBusy]=useState(false),[visualError,setVisualError]=useState(''),[previewTime,setPreviewTime]=useState(0);
  const visualAttempt=useRef(0);
  const [drawer,setDrawer]=useState<'production'|'checks'|'versions'>();
  const [assemblyTab,setAssemblyTab]=useState<AssemblyTab>('shot');
  const [seek,setSeek]=useState<{time:number;sequence:number}>();
  const [draftPreview,setDraftPreview]=useState<{shotId:string;cues:Array<{start:number;end:number;text:string}>}>();
  const [captionDrafts,setCaptionDrafts]=useState<Record<string,boolean>>({});
  const timingAttempt = useRef(0);
  const exportRequest = useRef<string>(), fileInput = useRef<HTMLInputElement>(null);
  const p = project?.plan, candidates = project?.candidates || [];
  useEffect(() => {
    const key = id + ':' + entryParams.toString();
    if (!p || project?.id !== id || focusedEntry.current === key) return;
    focusedEntry.current = key;
    const requestedStep=Number(entryParams.get('step'));
    if(entryParams.get('tab')==='voice')setAssemblyTab('voice');
    if(entryParams.has('step') && Number.isInteger(requestedStep) && requestedStep>=0 && requestedStep<=4) edit(prev=>({...prev,step:requestedStep}));
    const target = entryParams.get('shot');
    const index = p.shots.findIndex(s => s.id === target);
    if (index >= 0) { setShotIndex(index); setPage(Math.floor(index / 4)); const step = Number(entryParams.get('step')); if (step === 2 || step === 3) edit(prev => ({ ...prev, step })); }
  }, [id, project?.id, p, entryParams, edit]);
  const shot = p?.shots[Math.min(shotIndex, Math.max(0, p.shots.length - 1))];
  const shotId = shot?.id || '', step = p?.step || 0;
  useEffect(() => { setModelStatus('loading'); void dramaApi.models().then(items => { setModels(items); setModelStatus('ready'); }).catch(() => setModelStatus('error')); void dramaApi.capabilities().then(setCapabilities).catch(() => {}); }, [modelReload]);
  useEffect(() => { setShotIndex(0); setCastIndex(0); setPage(0); exportRequest.current = undefined; timingAttempt.current++; setTiming(undefined); setTimingBusy(false); setTimingError(''); setCaptionDrafts({}); }, [id]);
  useEffect(() => {
    if (!assetRequest) return; setAssetLoading(true);
    void workflowAssetsApi.list(assetPage, 20).then(r => { setAssetItems(r.data.items); setAssetTotal(r.data.total); }).catch(e => message.error(getApiErrorMessage(e, '素材加载失败'))).finally(() => setAssetLoading(false));
  }, [assetRequest, assetPage]);

  useEffect(()=>{setPreviewTime(0);setSeek(undefined);setDraftPreview(undefined);},[shotId]);
  const checkVisual = async () => {
    const attempt=++visualAttempt.current;setVisualBusy(true);setVisualError('');setVisual(undefined);
    try { const saved=await flush();if(!saved)return;const report=await dramaApi.mediaCheck(saved.id,saved.revision);if(attempt===visualAttempt.current)setVisual(report);}
    catch(e){if(attempt===visualAttempt.current)setVisualError(getApiErrorMessage(e,'画幅检查失败，请重试'));}
    finally{if(attempt===visualAttempt.current)setVisualBusy(false);}
  };
  const tryAction = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (e) { message.error(getApiErrorMessage(e, e instanceof Error ? e.message : '操作失败，请重试')); } finally { setBusy(false); } };
  const change = (patch: Partial<DramaPlan>) => edit(prev => {
    const next = { ...prev, ...patch };
    if (patch.story !== undefined || patch.style !== undefined) { next.storyConfirmed = false; next.castConfirmed = false; next.storyboardConfirmed = false; }
    if ((patch.characters || patch.scenes) && JSON.stringify(roleInputs(prev)) !== JSON.stringify(roleInputs(next))) { next.castConfirmed = false; next.storyboardConfirmed = false; }
    if (patch.shots && JSON.stringify(patch.shots.map(s => [s.id, s.description, s.duration, s.image, s.characterIds, s.sceneId])) !== JSON.stringify(prev.shots.map(s => [s.id, s.description, s.duration, s.image, s.characterIds, s.sceneId]))) next.storyboardConfirmed = false;
    return next;
  });
  const updateShot = (patch: Partial<NonNullable<typeof shot>>) => {
    if (!p || !shot) return;
    const updated = { ...shot, ...patch };
    if (patch.duration !== undefined) {
      updated.subtitleEnd = Math.min(updated.subtitleEnd ?? patch.duration, patch.duration);
      updated.subtitleStart = Math.min(updated.subtitleStart || 0, updated.subtitleEnd - 0.1);
      if(updated.captions) updated.captions=updated.captions.map(c=>({...c,end:Math.min(c.end,patch.duration!)})).filter(c=>c.end-c.start>=0.03);
    }
    change({ shots: p.shots.map(s => s.id === shot.id ? updated : s) });
  };
  const checkTiming = async () => {
    const attempt = ++timingAttempt.current; setTimingBusy(true); setTimingError(''); setTiming(undefined);
    try {
      const saved = await flush(); if (!saved) throw new Error('请先保存作品再检查旁白');
      const result = await dramaApi.voiceTiming(saved.id, saved.revision);
      if (attempt === timingAttempt.current) setTiming(result);
    } catch (e) { if (attempt === timingAttempt.current) setTimingError(getApiErrorMessage(e, '旁白检查失败，请重试')); }
    finally { if (attempt === timingAttempt.current) setTimingBusy(false); }
  };
  const fitTiming = () => {
    if (!p || !timing || timing.revision !== project?.revision || saveState !== 'saved') { message.info('请先保存并重新检查旁白'); return; }
    try {
      const fitted = fitVoiceTiming(p, timing.voices);
      Modal.confirm({ title: '延长镜头以容纳完整旁白？', content: '只延长旁白超长的镜头，保留已选视频。源片不足时延长最后一帧；修改后需要重新确认分镜。已手动设置的字幕范围会保留。', onOk: () => { edit({ ...fitted, step: 2 }); setTiming(undefined); setExportOpen(false); message.success('已调整时长，请检查分镜和字幕后重新确认'); } });
    } catch (e) { message.warning((e as Error).message); }
  };
  const settings = (patch: Partial<DramaPlan['settings']>) => { if (p) change({ settings: { ...p.settings, ...patch } }); };
  const go = (index: number) => { setDrawer(undefined); change({ step: index }); setPage(Math.floor(shotIndex / 4)); };
  const select = (candidate: DramaCandidate) => {
    if (!p || candidate.status !== 'succeeded') return;
    if (id) projectEvent('take_selected', id, candidate.id);
    if (candidate.kind === 'character' || candidate.kind === 'scene') { const list = candidate.kind === 'character' ? 'characters' : 'scenes'; change({ [list]: p[list].map(r => r.id === candidate.targetId ? { ...r, selected: candidate.id } : r) }); }
    else if (candidate.kind === 'music') settings({ music: candidate.id });
    else if (['image', 'video', 'voice'].includes(candidate.kind)) change({ shots: p.shots.map(s => s.id === candidate.targetId ? { ...s, [candidate.kind]: candidate.id } : s) });
  };
  const ask = (kind: DramaKind, ids: string[], label: string) => {
    if (capabilities?.generationEnabled === false) { message.info('新生成暂时暂停，仍可编辑作品、使用自己的素材及下载已有结果'); return; }
    if (project?.archived) { message.info('请先在作品列表恢复此作品，再继续生成'); return; }
    if (!ids.length) { message.info('请先添加制作内容'); return; }
    if (ids.some(targetId => candidates.some(c => c.kind === kind && c.targetId === targetId && isActive(c)))) { message.info('所选内容正在制作，请等待结果或先取消对应任务'); return; }
    if(kind==='video') void checkVisual();
    setGeneration({ kind, ids: ids.slice(0, 12), label });
  };
  const attach = async (asset: WorkflowAsset, request: AssetRequest) => {
    if (!id) return; await flush(); const candidate = await dramaApi.attach(id, request.kind, request.targetId, asset.id); await refresh(); select(candidate); setAssetRequest(undefined); message.success('素材已加入并选用');
  };
  const upload = async (file?: File) => {
    if (!file || !assetRequest) return;
    if (file.size > 20 * 1024 * 1024) { message.error('单个素材不超过 20 MB'); return; }
    setUploading(true); try { const r = await workflowAssetsApi.upload(file, undefined, 'short-drama'); await attach(r.data, assetRequest); } catch (e) { message.error(getApiErrorMessage(e, '素材上传失败，请重试')); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const openAssets = (kind: DramaKind, targetId: string) => { setAssetPage(1); setAssetRequest({ kind, targetId }); };
  const splitStory = () => {
    if (!p) return;
    const parts = p.story.split(/(?<=[。！？!?])\s*/).map(x => x.trim()).filter(Boolean).slice(0, 24);
    if (!parts.length) { message.info('先填写故事，再按句子拆分'); return; }
    Modal.confirm({ title: '按句子建立分镜草稿？', content: '这是简单的文字拆分，不调用模型。会替换分镜文字与选片，请检查每个画面再确认；已有候选仍会保留。', onOk: () => {
      change({ shots: parts.map((text, i) => ({ id: dramaId(), title: `镜头 ${i + 1}`, description: text, narration: text, duration: 5, characterIds: p.characters.map(c => c.id), sceneId: p.scenes[0]?.id })), storyboardConfirmed: false }); setShotIndex(0); setPage(0);
    } });
  };
  const next = () => void tryAction(async () => {
    const saved = await flush(); if (!saved) return; const plan = saved.plan;
    if (step === 0) {
      if (!plan.story.trim()) throw new Error('先写一句故事，或者使用示例试试');
      edit({ ...plan, storyConfirmed: true, step: 1 });
    } else if (step === 1) {
      if (!plan.storyConfirmed) throw new Error('故事已有修改，请先回到“写故事”重新确认');
      if (!plan.characters.length || plan.characters.some(r => !r.name.trim() || !r.description.trim())) throw new Error('请添加主角，并写清每个角色的名字和外貌设定');
      edit({ ...plan, castConfirmed: true, step: 2 });
    } else if (step === 2) {
      if (!plan.castConfirmed) throw new Error('请先确认角色与场景设定');
      if (!plan.shots.length || plan.shots.some(s => !s.description.trim() || !s.image)) throw new Error('请为每个镜头补充描述，并选用一张生成或上传的画面');
      edit({ ...plan, storyboardConfirmed: true, step: 3 });
    } else if (step === 3) {
      const media=guideMedia(plan,saved.candidates,'video');
      if(media.review.length){const index=plan.shots.findIndex(s=>s.id===media.review[0]);setShotIndex(index);message.info('请先预览并选用已有视频候选');return;}
      if(media.ready.length){guideAction({type:'select',kind:'video',choices:media.ready});return;}
      if(media.missing.length){ask('video',media.missing.slice(0,12),'补齐缺少的镜头视频');return;}
      if(media.working.length){message.info('镜头仍在制作，请等待结果后选用');return;}
      edit({ ...plan, step: 4 });
    } else { exportRequest.current = dramaId(); setExportOpen(true); void checkTiming(); void checkVisual(); }
    await flush();
  });
  const applyScript = (nextPlan: DramaPlan, impact: string[], base: DramaPlan) => {
    if (busy || saveState==='conflict' || recovery || project?.archived) return;
    Modal.confirm({ title: '确认采用这些内容？', content: <ul>{impact.map(line=><li key={line}>{line}</li>)}</ul>, okText:'确认采用', onOk: () => tryAction(async()=>{
      edit(current=>{if(JSON.stringify(current)!==JSON.stringify(base))throw new Error('确认期间草稿已有修改，请返回预览重新检查影响范围');return nextPlan;});
      setPreviewScript(undefined);setImportingScript(false);setShotIndex(0);await flush();message.success('已采用所选内容，已有候选与历史成片保留');
    }) });
  };
  const selectedId = (kind: DramaKind, targetId: string) => {
    if (!p) return undefined;
    if (kind === 'character' || kind === 'scene') return (kind === 'character' ? p.characters : p.scenes).find(x => x.id === targetId)?.selected;
    if (kind === 'music') return p.settings.music;
    return p.shots.find(s => s.id === targetId)?.[kind as 'image' | 'video' | 'voice'];
  };
  const candidatePanel = (kind: DramaKind, targetId: string) => <DramaCandidateBrowser key={kind+targetId} projectId={id!} plan={p!} kind={kind} list={targetCandidates(candidates,kind,targetId)} chosen={selectedId(kind,targetId)} disabled={busy || saveState==='conflict' || !!recovery || !!project?.archived} select={select} retry={()=>ask(kind,[targetId],'仅补做这一项')} cancel={c=>void tryAction(async()=>{if(id){await dramaApi.cancel(id,c.id);await refresh();}})}/>;

  if (loading) return <div className="drama-studio sd-loading"><Spin size="large" /></div>;
  if (!project || !p) return <div className="drama-studio sd-load-error"><Alert type="error" showIcon message={error || '作品不存在'} /><Button onClick={() => void load()}>重新加载</Button><Link to="/works?type=short-drama">返回我的作品</Link></div>;
  const selectedVideo = candidateFor(candidates, shot?.video), selectedImage = candidateFor(candidates, shot?.image);
  const totalSeconds = p.shots.reduce((n, s) => n + s.duration, 0), done = p.shots.filter(s => candidateFor(candidates, s.video)).length;
  const working = candidates.some(c => isActive(c));
  const frame = p.frame || { ratio: '9:16' as const, fit: 'contain' as const, voiceVolume: 100 };
  const generationProvider = (generation && p.production?.providers?.[generation.kind]) || p.production?.provider || 'akool-maas';
  const projectModels = generation?.kind === 'voice' ? models.filter(m => m.kinds.includes('voice')) : models.filter(m => m.provider === generationProvider);
  const videoMedia=guideMedia(p,candidates,'video');
  const selectReadyVideos = () => guideAction({type:'select',kind:'video',choices:guideMedia(p,candidates,'video').ready});
  const voiceBatch = voiceBatchTargets(p, candidates);
  const selectReadyVoices = () => guideAction({type:'select',kind:'voice',choices:guideMedia(p,candidates,'voice').ready});
  const currentRole = (castTab === 'scenes' ? p.scenes : p.characters)[castIndex];
  const roleList = castTab === 'scenes' ? p.scenes : p.characters, roleKind = castTab === 'scenes' ? 'scene' : 'character';
  const rolePhoto = candidateFor(candidates, currentRole?.selected);
  const saveLabel = { saved: '已保存', dirty: '待保存', saving: '正在保存…', error: '保存失败', conflict: '版本冲突' }[saveState];
  const exports = candidates.filter(c => c.kind === 'export');
  const currentTiming = timing?.projectId === project.id && timing.revision === project.revision && saveState === 'saved' ? timing : undefined;
  const timingBlocked = p.shots.some(s => s.voice) && (!currentTiming || currentTiming.voices.some(v => v.error || voiceOverflows(p.shots.find(s => s.id === v.shotId)!.duration, v.seconds)));
  const currentVisual=visual?.projectId===project.id && visual.revision===project.revision && saveState==='saved' ? visual : undefined;
  const locateMedia=(index:number,kind:'image'|'video')=>{setShotIndex(index);setPage(Math.floor(index/4));setExportOpen(false);go(kind==='image'?2:3);};
  const visualPanel=<DramaVisualCheck plan={p} report={currentVisual} busy={visualBusy} error={visualError} check={()=>void checkVisual()} locate={locateMedia} repair={(kind,targetId)=>{setExportOpen(false);ask(kind,[targetId],`重做当前镜头${kind==='image'?'画面':'视频'}（保留已有选片）`);}} disabled={busy || saveState==='conflict' || saveState==='error' || !!recovery || !!project.archived}/>;
  const unappliedCaptions=p.shots.filter(s=>captionDrafts[s.id] ?? !!readCaptionDraft(captionDraftKey(captionOwner,project.id,s.id)));
  const captionsBlocked=p.settings.subtitles && (p.shots.some(captionsStale) || unappliedCaptions.length>0);
  const previewCaption=shot && (draftPreview?.shotId===shot.id?draftPreview.cues:shotCaptions(shot)).find(c=>previewTime>=c.start && previewTime<c.end)?.text;
  const timingPanel = <DramaTimingCheck plan={p} report={currentTiming} busy={timingBusy} error={timingError} check={() => void checkTiming()} fit={fitTiming} locate={index => { setShotIndex(index); setExportOpen(false); }} />;
  const nextText = ['确认故事，去定角色', '确认设定，去看分镜', '分镜没问题，去做视频', videoMedia.review.length?'先检查已有候选':videoMedia.ready.length?`选用 ${videoMedia.ready.length} 项唯一候选`:videoMedia.missing.length?`查看补齐 ${Math.min(12,videoMedia.missing.length)} 项消耗`:videoMedia.working.length?'等待视频制作完成':'选片完成，去出成片', '检查并导出新版本'][step];
  const guideDisabled=busy || saveState==='conflict' || saveState==='error' || !!recovery || !!project.archived;
  const guideAction=(action:GuideAction) => {
    if(guideDisabled)return;
    if(action.type==='open') {
      if(action.voice)setAssemblyTab('voice');else if(action.step===1)setCastTab('characters');
      go(action.step);
      if(action.targetId){const index=p.shots.findIndex(s=>s.id===action.targetId);if(index>=0){setShotIndex(index);setPage(Math.floor(index/4));}}
    } else if(action.type==='confirm' || action.type==='export') {
      const current=dramaGuide(project).next.action;
      if(current.type!==action.type){message.info('进度已有更新，请按新的下一步继续');return;}
      next();
    } else if(action.type==='generate') {
      const current=guideMedia(p,candidates,action.kind);
      const ids=action.ids.filter(id=>current.missing.includes(id));
      if(!ids.length){message.info('这些内容已有结果或正在制作，请检查最新进度');return;}
      if(action.kind==='voice'){setAssemblyTab('voice');go(4);}
      ask(action.kind,ids,`继续制作缺少的${{image:'分镜画面',video:'镜头视频',voice:'镜头旁白'}[action.kind]}（${ids.length} 项）`);
    } else if(action.type==='select') {
      Modal.confirm({title:`选用 ${action.choices.length} 项唯一候选？`,content:'只填入尚未选片的镜头，每项须只有一个有效的已完成候选。已有选片保留；也可以取消后到对应步骤逐个预览。不会调用模型。',onOk:()=>tryAction(async()=>{
        const saved=await flush();if(!saved)return;
        edit(prev=>{
          const ready=guideMedia(prev,saved.candidates,action.kind).ready;
          const choices=action.choices.filter(choice=>ready.some(item=>item.targetId===choice.targetId && item.candidateId===choice.candidateId));
          return {...prev,...(action.kind==='image' && choices.length?{storyboardConfirmed:false}:{}),shots:prev.shots.map(s=>{const choice=choices.find(c=>c.targetId===s.id);return choice?{...s,[action.kind]:choice.candidateId}:s;})};
        });await flush();
      })});
    } else if(action.type==='resume') {
      Modal.confirm({title:'恢复此前已确认的生成请求？',content:`原请求涉及 ${action.count} 项，将按此前确认的报价继续提交，可能产生原报价内的生成消耗。复用原请求标识，已提交的项不会重复制作。`,okText:'恢复原请求',onOk:()=>tryAction(async()=>{await flush();await dramaApi.generate(project.id,action.requestId);await refresh();})});
    }
  };
  const focusShot=(index:number)=>{setShotIndex(index);setPage(Math.floor(index/4));};
  const voiceEditor=<><div className="sd-section-head"><div><h2>让每句话，都有自己的声音。</h2><p>为每个镜头制作旁白；可在制作配置中选择音色，也可以上传配音。</p></div></div>{!shot ? <Empty description="先在分镜页添加镜头和旁白" /> : <div className="sd-panel sd-editor"><div className="sd-actions"><Button disabled={!voiceBatch.missing.length} onClick={() => ask('voice', voiceBatch.missing, `批量制作缺少的旁白（${voiceBatch.missing.length} 项）`)}>批量制作缺少的旁白</Button><Button disabled={!Object.keys(voiceBatch.ready).length} onClick={selectReadyVoices}>选用各镜头唯一的已完成旁白</Button></div><p className="sd-note">每批最多 12 项，使用同一音色和配音设置；跳过已有选片、有效已完成或正在制作的候选，空台词保持静音；设定过期的旁白可重新制作。多个候选请逐镜头试听后选用。</p><label>选择镜头</label><Select aria-label="配音镜头" value={shot.id} options={p.shots.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title}` }))} onChange={value => setShotIndex(p.shots.findIndex(s => s.id === value))} /><label>旁白文字</label><Input.TextArea value={shot.narration} rows={3} maxLength={2000} onChange={e => updateShot({ narration: e.target.value })} /><div className="sd-actions"><Button onClick={() => ask('voice', [shotId], '制作当前镜头旁白')}>制作旁白</Button><Button icon={<CloudUploadOutlined aria-hidden="true" />} onClick={() => openAssets('voice', shotId)}>选用配音素材</Button></div>{candidatePanel('voice', shotId)}</div>}</>;
  return <div className="drama-studio sd-studio-layout"><div className="sd-window">
    <header className="sd-topbar"><Link to="/" className="sd-brand"><BrandIcon /><strong>Model Hub</strong></Link><span className="sd-breadcrumb">创作空间 / 短剧工作台</span><div className="sd-top-actions"><NotificationBell /><span className={`sd-save ${saveState === 'saved' ? '' : 'unsaved'}`} aria-live="polite">{saveState === 'saved' && <CheckOutlined aria-hidden="true" />} {saveLabel}</span><Button size="small" icon={<SaveOutlined aria-hidden="true" />} loading={saveState === 'saving'} onClick={() => void flush().catch(() => {})}>保存</Button></div></header>
    <div className="sd-shell"><aside className="sd-sidebar"><Button type="primary" ghost icon={<PlusOutlined aria-hidden="true" />} disabled={busy} onClick={() => void tryAction(async () => { await flush(); const created = await dramaApi.create({ ...exampleDrama(), title: '未命名短剧', story: '', characters: [], scenes: [], shots: [], production: { provider: 'akool-maas', models: {} } }); navigate(`/short-dramas/${created.id}`); })}>新建短剧</Button><small className="sd-side-label">创作空间</small><Link to="/works?type=short-drama"><FolderOpenOutlined aria-hidden="true" />我的作品</Link><button className="sd-nav-active" onClick={() => go(step)}><VideoCameraOutlined aria-hidden="true" />短剧制作</button><button onClick={() => { setCastTab('characters'); go(1); }}><PictureOutlined aria-hidden="true" />角色与素材</button><Link to="/create">开始创作</Link><Link to="/discover?type=short-drama">发现短剧模板</Link><div className="sd-side-help"><QuestionCircleOutlined aria-hidden="true" /><strong>第一次拍短剧？</strong><p>从一句故事开始，我们陪你走完每一步。</p><button onClick={() => setHelp(true)}>看看怎么做 ↗</button></div></aside>
    <main className="sd-workspace"><div className="sd-project-heading"><div><div className="sd-kicker"><Link to="/works?type=short-drama">我的作品</Link><span>/</span>第 1 集</div><Input aria-label="作品名称" className="sd-title-input" value={p.title} maxLength={100} onChange={e => change({ title: e.target.value })} /><p>一个故事，一组镜头，一步步完成你的短剧。</p></div><div className="sd-actions"><StageTemplateButton sources={project.stageTemplates} projectId={project.id} disabled={busy || project.archived} reload={refresh} prepare={async () => { const saved = await flush(); if (!saved) throw new Error("保存失败，请重试"); return saved.revision; }} /><TemplateSubmissionButton kind="short-drama" name={p.title} disabled={busy || !p.shots.length} prepare={async () => { const saved = await flush(); if (!saved) throw new Error("保存失败，请重试"); return saved.id; }} /><Button type="text" icon={<QuestionCircleOutlined aria-hidden="true" />} onClick={() => setHelp(true)}>创作帮助</Button></div></div>
    {recovery && <Alert type="warning" showIcon message="发现上次未保存的本机副本" description={recovery.baseRevision !== project.revision ? '服务端版本也有更新。采用本机副本会替换当前草稿，请先下载副本对比。' : '可恢复上次离开时的编辑。'} action={<div className="sd-actions"><Button size="small" onClick={() => downloadText(JSON.stringify(recovery.plan, null, 2), `${p.title}-本机草稿.json`, 'application/json')}>下载副本</Button><Button size="small" onClick={recover}>采用本机副本</Button><Button size="small" onClick={discardRecovery}>使用云端版本</Button></div>} />}
    {error && <Alert type="error" message={error} showIcon action={<div className="sd-actions"><Button size="small" onClick={() => downloadText(JSON.stringify(p, null, 2), `${p.title}-草稿.json`)}>下载我的编辑</Button>{saveState === 'conflict' ? <Button size="small" onClick={() => void load()}>查看最新云端版本</Button> : <Button size="small" onClick={() => void flush().catch(() => {})}>重试保存</Button>}</div>} />}
    <nav className="sd-stepper" aria-label="短剧制作步骤">{DRAMA_STEPS.map((name, i) => <button type="button" key={name} data-testid={`drama-step-${i}`} aria-current={i === step ? 'step' : undefined} className={(i === 0 && p.storyConfirmed || i === 1 && p.castConfirmed || i === 2 && p.storyboardConfirmed || i === 3 && done > 0 && done === p.shots.length) ? 'sd-done' : ''} onClick={() => go(i)}><span>{i + 1}</span>{name}</button>)}</nav>
    <section className="sd-stage">
    {capabilities?.generationEnabled === false && <Alert type="warning" message="新生成暂时暂停，已有作品仍可编辑、使用自有素材和下载。" />}
    {capabilities?.exportEnabled === false && <Alert type="warning" message="新合成暂时暂停，已有成片仍可播放和下载。" />}
    <DramaCreationGuide project={project} disabled={guideDisabled} act={guideAction} preferences={patch=>edit(prev=>({...prev,guide:{paused:false,narration:true,...prev.guide,...patch}}))} openBudget={()=>setDrawer('production')} openChecks={()=>setDrawer('checks')} openVersions={()=>setDrawer('versions')}/>
    {step === 0 && <><div className="sd-section-head"><div><h2>把一个灵感，变成你的第一部短剧。</h2><p>不用写提示词。说出故事，剩下的我们一步步完成。</p></div></div><div className="sd-story-grid"><div className="sd-panel"><div className="sd-chips"><button aria-pressed={p.inputMode === 'idea'} onClick={() => change({ inputMode: 'idea' })}>一句话开始</button><button aria-pressed={p.inputMode === 'script'} onClick={() => change({ inputMode: 'script' })}>我已有剧本</button></div><label htmlFor="drama-story">{p.inputMode === 'script' ? '粘贴你的剧本' : '你想讲一个什么故事？'}</label><Input.TextArea id="drama-story" value={p.story} rows={7} maxLength={12000} placeholder="比如：女孩收到一封信，信里的照片竟然拍摄于明天……" onChange={e => change({ story: e.target.value })} /><p className="sd-note">试试写清：谁，遇到了什么事，最后发生了什么。</p><div className="sd-form-grid"><div><label>画面风格</label><Select aria-label="画面风格" value={p.style} options={DRAMA_STYLES.map(value => ({ value, label: value }))} onChange={style => change({ style })} /></div><div><label>目标时长</label><Select aria-label="目标时长" value={p.duration} options={[30, 60, 90, 120].map(value => ({ value, label: `约 ${value} 秒` }))} onChange={duration => change({ duration })} /></div></div><div className="sd-actions"><Button onClick={() => setImportingScript(true)}>导入结构化剧本</Button><Button onClick={() => ask('script', ['project'], '完善故事与分镜草稿')}>帮我完善故事</Button><Button type="text" onClick={() => Modal.confirm({ title: '载入示例故事？', content: '会替换当前草稿文字与选片。已有候选仍会保留。', onOk: () => edit(exampleDrama()) })}>用示例试试</Button></div><div className="sd-tip"><QuestionCircleOutlined aria-hidden="true" />先确认故事，再制作画面。已有剧本可以直接手工确认。</div></div><div className="sd-poster"><img src="/drama/cafe.jpg" alt="绘本短剧画面风格示例" /><div className="sd-poster-text"><small>YOUR STORY STARTS HERE</small><strong>来自明天<br />的照片</strong><p>画面风格示例 · 尚未用于制作</p></div></div></div><div className="sd-script-results">{candidates.filter(c => c.kind === 'script').map((c, i) => <div className="sd-panel" key={c.id}><strong>剧本候选 {i + 1}</strong><Tag>{statusText[c.status]}</Tag>{c.text && <Button onClick={() => setPreviewScript(c)}>查看并采用</Button>}{c.error && <p className="sd-error-text">{c.error}</p>}</div>)}</div></>}

    {step === 1 && <><div className="sd-chips sd-tab-row">{(['characters', 'scenes'] as const).map((tab, i) => <button key={tab} aria-pressed={castTab === tab} onClick={() => { setCastTab(tab); setCastIndex(0); }}>{['角色形象', '场景设定', '旁白声音'][i]}</button>)}</div>
      {<><div className="sd-section-head"><div><h2>{castTab === 'scenes' ? '熟悉的地方，让故事更真实。' : '给故事里的主角一个模样。'}</h2><p>设定会关联到分镜。制作结果需要检查后选用。</p></div><Button icon={<PlusOutlined aria-hidden="true" />} disabled={roleList.length >= 8} onClick={() => { const key = castTab === 'scenes' ? 'scenes' : 'characters'; change({ [key]: [...roleList, { id: dramaId(), name: castTab === 'scenes' ? '新场景' : '新角色', description: '' }] }); setCastIndex(roleList.length); }}>添加{castTab === 'scenes' ? '场景' : '角色'}</Button></div><div className={`sd-cast-layout ${roleList.length === 1 ? 'sd-cast-single' : ''}`}><div><div className="sd-cast-grid">{roleList.map((role, i) => { const photo = candidateFor(candidates, role.selected); return <button key={role.id} className={`sd-cast-card ${castIndex === i ? 'sd-selected' : ''}`} onClick={() => setCastIndex(i)}>{photo?.url ? <DramaImage className="sd-cast-image" projectId={project.id} candidate={photo} alt={role.name} retryable={false} /> : <div className="sd-role-placeholder"><PictureOutlined aria-hidden="true" /><span>待制作{castTab === 'scenes' ? '场景' : '形象'}</span></div>}<span className="sd-cast-copy"><strong>{role.name}</strong><small>{role.description || '写下外貌、服装或环境设定'}</small></span></button>; })}</div>{!roleList.length && <Empty description="点击添加，或回到写故事让 AI 整理角色和场景" />}<div className="sd-tip"><CheckOutlined aria-hidden="true" />修改设定会提示重新确认，已有素材和候选均会保留。</div></div>{currentRole && <aside className="sd-panel sd-editor"><h3>{currentRole.name}的设定</h3><p className="sd-note">关联镜头：{p.shots.map((s,i) => (castTab === 'scenes' ? s.sceneId === currentRole.id : s.characterIds.includes(currentRole.id)) ? i+1 : null).filter(Boolean).join('、') || '暂无'}。修改外貌、环境或参考图后，这些镜头需要检查；仅改名不撤销确认，已有选片保留。</p><label>名称</label><Input aria-label="角色或场景名称" value={currentRole.name} maxLength={60} onChange={e => change({ [castTab]: roleList.map(r => r.id === currentRole.id ? { ...r, name: e.target.value } : r) })} /><label>{castTab === 'scenes' ? '环境和光线' : '外貌与服装'}</label><Input.TextArea aria-label="角色或场景描述" value={currentRole.description} rows={5} maxLength={2000} onChange={e => change({ [castTab]: roleList.map(r => r.id === currentRole.id ? { ...r, description: e.target.value } : r) })} />{rolePhoto?.url && <DramaImage className="sd-shot-editor-photo" projectId={project.id} candidate={rolePhoto} alt={currentRole.name} />}<Button type="primary" icon={<ReloadOutlined aria-hidden="true" />} onClick={() => ask(roleKind, [currentRole.id], `制作${currentRole.name}的${castTab === 'scenes' ? '场景' : '形象'}`)}>制作一个新候选</Button><Button icon={<CloudUploadOutlined aria-hidden="true" />} onClick={() => openAssets(roleKind, currentRole.id)}>上传或选择素材</Button>{candidatePanel(roleKind, currentRole.id)}</aside>}</div></>}
    </>}

    {(step === 2 || step === 3) && shot && <div className="sd-actions"><ShotWorkflowButton projectId={project.id} shotId={shot.id} disabled={busy || capabilities?.generationEnabled === false} prepare={async () => { const saved = await flush(); if (!saved) throw new Error("保存失败，请重试"); return saved.revision; }} /></div>}
    {step === 2 && <><div className="sd-section-head"><div><h2>先看懂故事，再让画面动起来。</h2><p>共 {p.shots.length} 个镜头 · {totalSeconds} 秒。点击一个镜头，修改画面和旁白。</p></div><div className="sd-actions"><Button size="small" onClick={splitStory}>按句子拆分</Button><Button size="small" onClick={() => { if (p.shots.length >= 24 || totalSeconds > 175) return message.info('首版每集最多 24 个镜头、180 秒'); change({ shots: [...p.shots, { id: dramaId(), title: `镜头 ${p.shots.length + 1}`, description: '', narration: '', duration: 5, characterIds: [], sceneId: p.scenes[0]?.id }] }); setShotIndex(p.shots.length); setPage(Math.floor(p.shots.length / 4)); }}>添加镜头</Button></div></div><div className="sd-storyboard-layout"><DramaShotNavigator key="storyboard" project={project} kind="image" index={shotIndex} focus={focusShot} edit={edit} disabled={guideDisabled} generate={ids=>ask('image',ids,'补齐所选镜头缺少的画面')}/>{shot && <aside className="sd-panel sd-editor"><div className="sd-section-head"><h3>镜头 {String(p.shots.indexOf(shot) + 1).padStart(2, '0')}</h3><InputNumber aria-label="镜头时长" min={2} max={15} value={shot.duration} addonAfter="秒" onChange={value => value && updateShot({ duration: value })} /></div><div className="sd-locked"><LinkOutlined aria-hidden="true" />{shot.characterIds.map(roleId => p.characters.find(r => r.id === roleId)?.name).filter(Boolean).join('、') || '尚未关联角色'}</div>{selectedImage?.url && <DramaImage className="sd-shot-editor-photo" projectId={project.id} candidate={selectedImage} alt={shot.title} />}<label>镜头标题</label><Input aria-label="镜头标题" value={shot.title} maxLength={100} onChange={e => updateShot({ title: e.target.value })} /><label>画面描述</label><Input.TextArea aria-label="画面描述" value={shot.description} rows={3} maxLength={3000} onChange={e => updateShot({ description: e.target.value })} /><label>旁白 / 字幕</label><Input.TextArea aria-label="旁白或字幕" value={shot.narration} rows={3} maxLength={2000} onChange={e => updateShot({ narration: e.target.value })} /><label>关联角色</label><Select aria-label="关联角色" mode="multiple" value={shot.characterIds} options={p.characters.map(c => ({ value: c.id, label: c.name }))} onChange={characterIds => updateShot({ characterIds })} /><label>场景</label><Select aria-label="场景" allowClear value={shot.sceneId} options={p.scenes.map(c => ({ value: c.id, label: c.name }))} onChange={sceneId => updateShot({ sceneId })} /><Button type="primary" onClick={() => ask('image', [shotId], '为当前镜头制作新画面')}><ReloadOutlined aria-hidden="true" />制作一张画面</Button><Button onClick={() => openAssets('image', shotId)}><CloudUploadOutlined aria-hidden="true" />上传或选择画面</Button>{candidatePanel('image', shotId)}</aside>}</div></>}

    {step === 3 && <><div className="sd-section-head"><div><h2>{p.shots.length && done === p.shots.length ? '镜头准备好了，接下来把故事串起来。' : '让每一个镜头，都成为故事的一部分。'}</h2><p>已选用 {done} / {p.shots.length} 个镜头。重做只新增候选，已有选片保留。</p></div><Tag>{done} / {p.shots.length}</Tag></div>{!p.storyboardConfirmed && <Alert type="info" message="请先检查分镜，选用每个镜头的画面，再确认制作视频。" action={<Button onClick={() => go(2)}>去检查分镜</Button>} />}
      <div className="sd-actions"><Button disabled={!missingBatch(p,candidates,'video').length} onClick={()=>ask('video',missingBatch(p,candidates,'video').slice(0,3),'先试做最多 3 个缺少视频的镜头')}>先试做一小段</Button><Button disabled={!videoMedia.ready.length} onClick={selectReadyVideos}>选用各镜头唯一的已完成候选</Button></div><div className="sd-takes-layout"><DramaShotNavigator key="videos" project={project} kind="video" index={shotIndex} focus={focusShot} edit={edit} disabled={guideDisabled} generate={ids=>ask('video',ids,'补齐所选镜头缺少的视频')}/>{shot && <div className="sd-panel sd-take-editor"><div className="sd-section-head"><div><h3>镜头 {p.shots.indexOf(shot) + 1} · {shot.title}</h3><p>候选可以分别预览，满意后选用。失败只重做这个镜头。</p></div><div className="sd-actions"><Button onClick={() => ask('video', [shotId], '仅为当前镜头新增一个视频候选')} icon={<ReloadOutlined aria-hidden="true" />}>仅制作这个镜头</Button><Button onClick={() => openAssets('video', shotId)} icon={<CloudUploadOutlined aria-hidden="true" />}>上传镜头视频</Button></div></div>{candidatePanel('video', shotId)}</div>}</div>
    </>}

    {step === 4 && <><DramaVersionStatus plan={p} candidates={candidates}/>
      {!p.storyboardConfirmed && <Alert type="info" message="分镜已修改，请重新确认后导出，已有视频保留。" action={<Button onClick={()=>go(2)}>去确认分镜</Button>}/>}
      <div className="sd-section-head"><div><h2>预览你的故事，完成最后的调整。</h2><p>镜头剪辑、旁白、字幕与全片设置分开编辑。</p></div><Tag>{frame.ratio} · {totalSeconds} 秒</Tag></div>
      <DramaAssemblyWorkspace project={project} index={shotIndex} previewSequence={seek?.sequence} tab={assemblyTab} setTab={setAssemblyTab} focus={focusShot} disabled={guideDisabled} reorder={(index,delta)=>{const shots=[...p.shots];[shots[index],shots[index+delta]]=[shots[index+delta],shots[index]];change({shots});setShotIndex(index+delta);}} versions={()=>setDrawer('versions')}
        navigator={<DramaShotNavigator key={'assembly-'+(assemblyTab==='voice'?'voice':'video')} project={project} kind={assemblyTab==='voice'?'voice':'video'} index={shotIndex} focus={focusShot} edit={edit} disabled={guideDisabled} generate={ids=>ask(assemblyTab==='voice'?'voice':'video',ids,'补齐所选镜头缺项')}/>}
        preview={<div className="sd-player-bed"><div className="sd-player" style={{aspectRatio:frame.ratio.replace(':','/')}}>{selectedVideo?.url ? <DramaMedia key={selectedVideo.id} projectId={project.id} candidate={selectedVideo} fit={frame.fit} startTime={shot?.trimStart} seekTo={seek && {time:seek.time+(shot?.trimStart || 0),sequence:seek.sequence}} onTimeUpdate={seconds=>setPreviewTime(Math.max(0,seconds-(shot?.trimStart || 0)))} /> : selectedImage?.url ? <DramaImage projectId={project.id} candidate={selectedImage} alt={shot?.title || '镜头画面'} style={{width:'100%',height:'100%',objectFit:frame.fit}} /> : <div className="sd-shot-placeholder"><PlayCircleOutlined aria-hidden="true" /><span>先选用一个镜头视频</span></div>}<span className="sd-player-tag">{selectedVideo ? '当前镜头预览' : '画面预览'}</span>{p.settings.subtitles && <span className={`sd-player-caption ${p.settings.subtitleStyle === 'warm' ? 'warm' : ''}`}>{previewCaption}</span>}</div><p className="sd-note">镜头 {(p.shots.indexOf(shot!) + 1) || 0} / {p.shots.length} · 完整影片请切换“已导出成片”</p>{shot?.voice && <DramaMedia projectId={project.id} candidate={candidateFor(candidates,shot.voice)!} audio onTimeUpdate={seconds=>setPreviewTime(Math.min(shot.duration,seconds))}/>}</div>}
        clip={<div className="sd-inspector-fields"><h3>当前镜头 · {shot?.title}</h3><label>当前镜头时长（秒）</label><InputNumber aria-label="成片镜头时长" min={2} max={15} precision={0} value={shot?.duration} onChange={value => updateShot({ duration: value || 2 })} /><label>当前镜头视频起点（秒）</label><InputNumber aria-label="视频裁剪起点" min={0} max={180} step={0.1} value={shot?.trimStart || 0} onChange={value => updateShot({trimStart:value || 0})} /><p className="sd-note">从起点使用 {shot?.duration} 秒；源片不足时延长最后一帧，请检查导出结果。</p><label>当前字幕显示范围（镜头内秒数）</label><InputNumber aria-label="字幕开始秒数" min={0} max={shot?.duration} step={0.1} value={shot?.subtitleStart || 0} onChange={value => updateShot({subtitleStart:value || 0})} /><InputNumber aria-label="字幕结束秒数" min={0.1} max={shot?.duration} step={0.1} value={shot?.subtitleEnd ?? shot?.duration} onChange={value => updateShot({subtitleEnd:value ?? shot?.duration})} /><Button onClick={()=>{setAssemblyTab('voice');}}>编辑旁白与声音</Button></div>}
        voice={voiceEditor}
        captions={<div className="sd-inspector-fields"><p className="sd-scope-label">字幕显示与样式应用于全片；分句校正只修改当前镜头。</p><Checkbox checked={p.settings.subtitles} onChange={e => settings({ subtitles: e.target.checked })}>显示字幕</Checkbox><label>字幕样式</label><Select aria-label="字幕样式" value={p.settings.subtitleStyle} options={[{ value: 'white', label: '简洁白字 · 底部居中' }, { value: 'warm', label: '柔和米色 · 底部居中' }]} onChange={subtitleStyle => settings({ subtitleStyle })} />{shot && <DramaCaptionEditor key={shot.id} projectId={project.id} shot={shot} voice={candidateFor(candidates,shot.voice)} previewTime={previewTime} onSeek={seconds=>{setPreviewTime(seconds);setSeek(prev=>({time:seconds,sequence:(prev?.sequence || 0)+1}));}} onDraftPreview={cues=>setDraftPreview({shotId:shot.id,cues})} onDirty={dirty=>setCaptionDrafts(prev=>prev[shot.id]===dirty?prev:{...prev,[shot.id]:dirty})} analyze={async()=>{const saved=await flush();if(!saved)throw new Error('请先保存作品');const report=await dramaApi.captionTiming(saved.id,saved.revision);const voice=report.voices.find(v=>v.shotId===shot.id && v.voiceId===shot.voice);if(!voice)throw new Error('请先为镜头选用旁白');return voice;}} apply={(captions,source,method)=>{let applied=false;edit(prev=>{const current=prev.shots.find(s=>s.id===source.id);if(!current || ['narration','voice','duration','subtitleStart','subtitleEnd'].some(key=>current[key as keyof typeof current]!==source[key as keyof typeof source])){message.warning('检查期间镜头已有编辑，请重新对齐字幕');return prev;}applied=true;return {...prev,shots:prev.shots.map(s=>s.id===source.id?{...s,captions,captionSource:{narration:s.narration,voiceId:s.voice,method}}:s)};});return applied;}}/>}</div>}
        film={<div className="sd-inspector-fields"><p className="sd-scope-label">以下设置应用于整部影片，只影响新导出的版本。</p><label>成片画幅</label><Select aria-label="成片画幅" value={frame.ratio} options={['9:16','16:9','1:1'].map(value => ({value,label:value}))} onChange={ratio => change({frame:{...frame,ratio:ratio as typeof frame.ratio}, storyboardConfirmed:false})} /><label>画面适配</label><Select aria-label="画面适配" value={frame.fit} options={[{value:'contain',label:'保留完整画面（可能留边）'},{value:'cover',label:'填满画面（居中裁切）'}]} onChange={fit => change({frame:{...frame,fit:fit as typeof frame.fit}})} /><p className="sd-note">裁切会隐藏边缘内容，请检查人物和文字。改变画幅后需要重新确认分镜。</p><label>导出清晰度</label><Select aria-label="全片清晰度" value={p.settings.resolution} options={[{value:'720p',label:'720p'},{value:'1080p',label:'1080p'}]} onChange={resolution=>settings({resolution})}/><label>旁白音量 {frame.voiceVolume}%</label><Slider aria-label="旁白音量" min={0} max={200} value={frame.voiceVolume} onChange={voiceVolume => change({frame:{...frame,voiceVolume}})} /><Checkbox checked={p.settings.normalizeVoice === true} onChange={e => settings({ normalizeVoice: e.target.checked })}>统一旁白响度</Checkbox><p className="sd-note">减小不同旁白之间的音量差异，再按上方音量调整；只影响新导出的版本。</p><p>修改这些设置，只重新合成，不重做视频。</p><label>配乐音量 {p.settings.musicVolume}%</label><Slider value={p.settings.musicVolume} onChange={musicVolume => settings({ musicVolume })} /><Checkbox checked={p.settings.musicDucking === true} onChange={e => settings({ musicDucking: e.target.checked })}>旁白说话时降低配乐</Checkbox><Button disabled={!models.some(m => m.kinds.includes('music') && m.provider === (p.production?.providers?.music || p.production?.provider || 'akool-maas'))} icon={<AudioOutlined aria-hidden="true" />} onClick={() => ask('music', ['project'], '制作一段故事配乐')}>制作配乐</Button><Button onClick={() => openAssets('music', 'project')}>上传或选择配乐</Button>{p.settings.music && <Button onClick={() => settings({ music: undefined })}>移除当前配乐</Button>}{!models.some(m => m.kinds.includes('music') && m.provider === (p.production?.providers?.music || p.production?.provider || 'akool-maas')) && <p className="sd-note">尚未配置可用的配乐生成模型，可先上传自己的音乐；启用并定价后可制作 AI 配乐。</p>}{candidatePanel('music', 'project')}</div>}
      />
    </>}
    </section><footer className="sd-bottom"><Button icon={<ArrowLeftOutlined aria-hidden="true" />} disabled={!step || busy} onClick={() => go(step - 1)}>上一步</Button><span className="sd-bottom-note">{step < 3 ? '编辑与确认不新增生成消耗' : '开始前确认范围与积分，已有结果保留'}</span><Button type="primary" data-testid="drama-next" loading={busy} disabled={saveState === 'conflict' || !!recovery || (step === 3 && !p.shots.length)} onClick={next}>{nextText} <ArrowRightOutlined aria-hidden="true" /></Button></footer></main></div></div>
    <Drawer title={drawer==='production'?'任务、预算与制作方案':drawer==='checks'?'制作检查':'成片版本与下载'} open={!!drawer} onClose={()=>setDrawer(undefined)} width="min(860px, 96vw)"><div className="drama-studio sd-detail-drawer">
      {drawer==='production' && <><DramaProductionPanel project={project} models={models} modelStatus={modelStatus} refreshModels={()=>setModelReload(v=>v+1)} edit={edit} flush={flush} reload={refresh} mutate={mutate} retry={(kind,ids,label)=>{setDrawer(undefined);kind==='export'?go(4):ask(kind,ids,label);}} run={action=>void tryAction(action)}/><h3>后台制作任务</h3>{!candidates.some(isActive) && <p>没有正在制作的任务。</p>}{candidates.filter(isActive).map(c=><div className="sd-task-row" key={c.id}><span>{p.shots.find(s=>s.id===c.targetId)?.title || '作品'} · {({image:'画面',video:'视频',voice:'旁白',export:'成片',character:'角色',scene:'场景',script:'剧本',music:'配乐'} as Record<string,string>)[c.kind]}</span><Tag>{statusText[c.status]}</Tag>{c.taskId && c.kind!=='export' && <Button disabled={guideDisabled} onClick={()=>void tryAction(async()=>{await dramaApi.cancel(project.id,c.id);await refresh();})}>取消这一项</Button>}</div>)}</>}
      {drawer==='checks' && <><DramaContinuityCheck project={project} disabled={guideDisabled} locate={locateMedia} role={(kind,roleId)=>{setCastTab(kind==='character'?'characters':'scenes');setCastIndex((kind==='character'?p.characters:p.scenes).findIndex(r=>r.id===roleId));go(1);}}/>{visualPanel}{timingPanel}</>}
      {drawer==='versions' && <><p className="sd-note">历史成片是独立文件；当前草稿修改不会更新旧版本。请预览核对后决定是否重新导出。</p><div className="sd-section-head"><h3>成片与导出版本</h3><Button icon={<DownloadOutlined aria-hidden="true" />} onClick={() => downloadText(planSrt(p), `${p.title}.srt`)}>下载当前 SRT 字幕</Button></div>{!exports.length && <p className="sd-note">确认导出后，成片任务和历史版本会出现在这里。</p>}{exports.map((c, i) => <div className="sd-panel sd-export-result" key={c.id}><strong>成片版本 {i + 1}</strong>{c.status === 'succeeded' && <DramaVersionStatus plan={p} candidates={candidates} candidate={c}/>}<Tag>{statusText[c.status]}</Tag>{c.url && <><DramaMedia projectId={id!} candidate={c} /><a href={c.url} target="_blank" rel="noreferrer" onClick={() => projectEvent('download_started', project.id, c.id)}>打开 / 下载 MP4</a><Button size="small" onClick={() => downloadText(c.text || '', `${p.title}-v${i + 1}.srt`)}>下载此版本字幕</Button></>}{c.error && <Alert type="error" message={c.error} />}</div>)}</>}
    </div></Drawer>
    {generation && <DramaGenerationModal key={`${generation.kind}-${generation.ids.join(',')}`} projectId={project.id} plan={p} candidates={candidates} visualReport={currentVisual} visualBusy={visualBusy} budgetRemaining={project.budget?.remaining} request={generation} models={projectModels} preferredConfigId={p.production?.models?.[generation.kind]} onClose={() => setGeneration(undefined)} preferredParameters={generation.kind === 'voice' ? p.production?.voiceParameters : undefined} beforeQuote={async (configId, parameters) => { if (generation.kind === 'voice' && configId) edit(prev => ({ ...prev, production: { ...prev.production, provider: prev.production?.provider || 'akool-maas', providers: { ...prev.production?.providers, voice: models.find(m => m.configId === configId)?.provider || generationProvider }, models: { ...prev.production?.models, voice: configId }, voiceParameters: Object.fromEntries(Object.entries(parameters || {}).filter(([,value]) => value !== undefined)) } })); return flush(); }} onStarted={refresh} />}
    <Modal open={help} title="你的第一部短剧，五步完成。" onCancel={() => setHelp(false)} footer={<Button type="primary" onClick={() => setHelp(false)}>明白了</Button>}><ol className="sd-help-list">{DRAMA_STEPS.map((name, i) => <li key={name}><strong>{name}</strong><p>{['写下一句话、粘贴剧本，或者从示例开始。AI 生成的剧本先检查再采用。', '补全角色外貌和场景描述，可生成形象，也可以上传自己的图。', '检查画面顺序和旁白，为每个镜头制作并选用关键帧。', '先查看消耗再制作。逐个预览候选，失败只重做对应镜头。', '调整镜头顺序、字幕、旁白和配乐，导出真实 MP4 与 SRT。'][i]}</p></li>)}</ol><Alert type="info" message="可以随时返回修改。上游内容修改后要重新确认，已经生成的候选会保留。" /></Modal>
    <Modal open={!!previewScript || importingScript} title="检查剧本草稿" width={760} onCancel={() => {setPreviewScript(undefined);setImportingScript(false);}} footer={null} destroyOnClose>{(previewScript || importingScript) && <DramaScriptReview text={previewScript?.text || ''} plan={p} apply={applyScript} />}</Modal>
    <Modal open={!!assetRequest} title="选用你的素材" onCancel={uploading ? undefined : () => setAssetRequest(undefined)} footer={<div className="sd-actions"><Button disabled={assetPage <= 1 || assetLoading} onClick={() => setAssetPage(assetPage - 1)}>上一页</Button><span>第 {assetPage} 页</span><Button disabled={assetPage * 20 >= assetTotal || assetLoading} onClick={() => setAssetPage(assetPage + 1)}>下一页</Button><Button type="primary" loading={uploading} icon={<CloudUploadOutlined aria-hidden="true" />} onClick={() => fileInput.current?.click()}>上传并选用</Button></div>}>
      <input ref={fileInput} type="file" hidden accept={assetRequest ? `${kindMedia(assetRequest.kind)}/*` : undefined} onChange={e => void upload(e.target.files?.[0])} /><p>上传真实素材或从素材库选用，单个文件不超过 20 MB。</p>{assetLoading ? <Spin /> : <div className="sd-asset-grid">{assetItems.filter(a => a.kind === (assetRequest && kindMedia(assetRequest.kind))).map(a => <button type="button" key={a.id} disabled={busy || uploading} onClick={() => assetRequest && void tryAction(() => attach(a, assetRequest))}>{a.kind === 'image' ? <img src={a.url} alt={a.name} /> : a.kind === 'video' ? <VideoCameraOutlined aria-hidden="true" /> : <AudioOutlined aria-hidden="true" />}<span>{a.name}</span></button>)}</div>}{!assetLoading && !assetItems.some(a => a.kind === (assetRequest && kindMedia(assetRequest.kind))) && <Empty description="本页没有匹配素材，可翻页或上传" />}
    </Modal>
    <Modal open={exportOpen} title="准备好交出你的故事了吗？" onCancel={busy ? undefined : () => setExportOpen(false)} footer={<><Button disabled={busy} onClick={() => setExportOpen(false)}>再检查一下</Button><Button type="primary" loading={busy} disabled={captionsBlocked || timingBusy || timingBlocked || capabilities?.exportEnabled === false || !p.storyboardConfirmed || !capabilities?.mp4 || (p.settings.subtitles && !capabilities.subtitles) || done !== p.shots.length || !p.shots.length} onClick={() => void tryAction(async () => { const saved = await flush(); if (!saved) return; exportRequest.current ||= dramaId(); await dramaApi.export(saved.id, saved.revision, exportRequest.current); await refresh(); setExportOpen(false); message.success('成片任务已提交，可以离开页面，稍后回来查看'); })}>确认导出 MP4</Button></>}>
      {!p.storyboardConfirmed && <Alert type="info" message="请返回看分镜步骤，重新检查并确认分镜后导出" />}{!capabilities?.mp4 && <Alert type="warning" message={capabilities?.reason || '正在检查成片服务，请稍后重试'} />}{capabilities?.mp4 && !capabilities.subtitles && <Alert type="warning" message={capabilities.reason} />}{done !== p.shots.length && <Alert type="info" message={`还有 ${p.shots.length - done} 个镜头没有选用视频，请先完成选片`} />}
      <div className="drama-studio">{visualPanel}{timingPanel}{captionsBlocked && <Alert type="warning" message={unappliedCaptions.length?`有 ${unappliedCaptions.length} 个镜头的字幕修改尚未应用，请回到对应镜头应用或放弃后再导出。`:'旁白已有修改，请重新对齐字幕或应用手动校正后再导出。'}/>}<label>清晰度</label><Select aria-label="导出清晰度" value={p.settings.resolution} style={{ width: '100%' }} options={[{ value: '720p', label: '720p · 更小的文件' }, { value: '1080p', label: '1080p · 更大的输出尺寸' }]} onChange={resolution => settings({ resolution })} /><p>{frame.ratio} · {totalSeconds} 秒 · MP4 + SRT</p><p>旁白已选用 {p.shots.filter(s => s.voice).length} / {p.shots.length} 个镜头；未配置旁白的镜头按静音合成。</p><p>{working ? '仍有任务正在制作，本次按当前已选用候选导出。' : '按当前选片、字幕与配乐设置生成一个新版本。'}</p><p className="sd-note">导出不重新调用生成模型。开始后修改草稿不会改变本次导出快照。</p></div>
    </Modal>
  </div>;
}
