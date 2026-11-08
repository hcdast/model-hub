import type { DramaCandidate, DramaPlan, DramaProject } from './drama.types';
import { exportVersionState } from './drama-version';
import { captionsStale } from './drama-captions';

export type GuideMediaKind = 'image' | 'video' | 'voice';
export type GuideAction =
  | { type: 'open'; step: number; targetId?: string; voice?: boolean }
  | { type: 'confirm'; step: number }
  | { type: 'generate'; kind: GuideMediaKind; ids: string[] }
  | { type: 'select'; kind: GuideMediaKind; choices: Array<{ targetId: string; candidateId: string }> }
  | { type: 'export' } | { type: 'wait' } | { type: 'resume'; requestId: string; count: number };
export interface GuideStage { title: string; detail: string; done: boolean; step: number; voice?: boolean }
export interface GuideNext { title: string; detail: string; label: string; action: GuideAction }

/** A usable candidate must belong to this target, not merely share an ID. */
export function guideMedia(plan: DramaPlan, candidates: DramaCandidate[], kind: GuideMediaKind) {
  const targets = kind === 'voice' ? plan.shots.filter(s => s.narration.trim()) : plan.shots;
  const selected: string[] = [], missing: string[] = [], working: string[] = [], review: string[] = [];
  const ready: Array<{ targetId: string; candidateId: string }> = [];
  let failed = 0, stale = 0;
  for (const shot of targets) {
    const list = candidates.filter(c => c.kind === kind && c.targetId === shot.id);
    const chosen = list.find(c => c.id === shot[kind] && c.status === 'succeeded' && c.url);
    if (chosen) { selected.push(shot.id); if (chosen.stale) stale++; continue; }
    // Wait for the current attempt before treating an older result as the only choice.
    if (list.some(c => c.status === 'pending' || c.status === 'running')) { working.push(shot.id); continue; }
    const completed = list.filter(c => c.status === 'succeeded' && c.url && !c.stale);
    if (completed.length === 1) ready.push({ targetId: shot.id, candidateId: completed[0].id });
    else if (completed.length > 1) review.push(shot.id);
    else { missing.push(shot.id); if (list.some(c => c.status === 'failed')) failed++; }
  }
  return { total: targets.length, selected, missing, working, ready, review, failed, stale };
}

/** Derive resumption from saved choices and live tasks. Never enqueue from this function. */
export function dramaGuide(project: DramaProject) {
  const { plan: p, candidates } = project;
  const image = guideMedia(p, candidates, 'image'), video = guideMedia(p, candidates, 'video'), voice = guideMedia(p, candidates, 'voice');
  const storyDone = !!p.story.trim() && p.storyConfirmed;
  const castValid = p.characters.length > 0 && p.characters.every(r => !!r.name.trim() && !!r.description.trim());
  const castDone = storyDone && castValid && p.castConfirmed;
  const shotsValid = p.shots.length > 0 && p.shots.every(s => !!s.description.trim());
  const imageDone = castDone && shotsValid && image.selected.length === image.total && p.storyboardConfirmed;
  const videoDone = imageDone && video.selected.length === video.total;
  const wantsVoice = p.guide?.narration !== false;
  const voiceDone = videoDone && (!wantsVoice || voice.selected.length === voice.total);
  const exports = candidates.filter(c => c.kind === 'export' && c.status === 'succeeded' && c.url).length;
  const version = exportVersionState(p,candidates);
  const captionsNeedReview = p.settings.subtitles && p.shots.some(captionsStale);
  const activeExports = candidates.filter(c => c.kind === 'export' && ['pending','running'].includes(c.status)).length;
  const count = (m: ReturnType<typeof guideMedia>) => `已选 ${m.selected.length}/${m.total} · 待选 ${m.ready.length + m.review.length} · 制作中 ${m.working.length} · 待补 ${m.missing.length}`;
  const stages: GuideStage[] = [
    { title: '确认故事', detail: storyDone ? '故事已确认，修改后需要再次确认' : '写清主角、冲突与结局，再确认故事', done: storyDone, step: 0 },
    { title: '确认角色', detail: castDone ? `${p.characters.length} 个角色 · ${p.scenes.length} 个场景；参考图可在设定页补充` : '补全角色外貌与场景，检查后确认', done: castDone, step: 1 },
    { title: '选分镜画面', detail: p.shots.length ? count(image) : '先建立分镜，每个镜头选一张画面', done: imageDone, step: 2 },
    { title: '选镜头视频', detail: p.shots.length ? count(video) : '确认分镜后，分批制作视频', done: videoDone, step: 3 },
    { title: '出成片', detail: `${wantsVoice ? `旁白 ${voice.selected.length}/${voice.total}` : '已跳过缺少的旁白'} · ${activeExports ? `${activeExports} 个成片正在合成` : captionsNeedReview ? '旁白或文字已修改，字幕需要重新校正' : version.matched ? '当前草稿的输出内容已导出' : exports ? `已有 ${exports} 个历史版本；${version.status==='changed'?'当前草稿修改尚未导出':'当前草稿与旧成片无法自动核对'}` : '检查字幕、声音后导出 MP4'}`, done: voiceDone && !captionsNeedReview && !!version.matched, step: 4 },
  ];
  const open = (step: number, targetId?: string, isVoice = false): GuideAction => ({ type:'open', step, targetId, voice: isVoice });
  const confirmation = (step: number): GuideAction => p.step === step ? {type:'confirm',step} : open(step);
  const mediaNext = (kind: GuideMediaKind, m: ReturnType<typeof guideMedia>, step: number, label: string): GuideNext => {
    if (m.review.length) return { title:`先检查${label}候选`,detail:'这些镜头有多个可用候选，请预览后逐个选用。',label:'去检查候选',action:open(step,m.review[0],kind==='voice') };
    if (m.ready.length) return { title:`${m.ready.length} 项${label}可以选用`,detail:'每项只有一个有效候选。可先预览，再明确选用；不会新生成。',label:`选用 ${m.ready.length} 项唯一候选`,action:{type:'select',kind,choices:m.ready} };
    if (m.missing.length) return { title:`继续制作${label}`,detail:`还有 ${m.missing.length} 项没有可用结果${m.failed ? `，其中 ${m.failed} 项此前失败` : ''}。已有选片和正在制作的项会跳过，每批最多 12 项。`,label:`查看 ${Math.min(12,m.missing.length)} 项消耗`,action:{type:'generate',kind,ids:m.missing.slice(0,12)} };
    return { title:`${label}正在制作`,detail:'任务会在后台继续。可先离开页面，回来后按现有任务与选片继续。',label:'等待制作结果',action:{type:'wait'} };
  };
  let next: GuideNext;
  if (!storyDone) next = { title:'先确认你想讲的故事', detail:'可以手写、导入剧本，或让 AI 完善。生成的草稿需要先检查并采用。', label:p.story.trim() && p.step===0?'确认故事，继续':'去写故事', action:p.story.trim()?confirmation(0):open(0) };
  else if (!castDone) next = { title:'确认主角与场景设定',detail:'角色至少需要名字和外貌描述；参考图可生成或上传。',label:castValid && p.step===1?'确认设定，继续':'去定角色',action:castValid?confirmation(1):open(1) };
  else if (!shotsValid) next = { title:'建立分镜草稿',detail:'先添加镜头、描述和旁白，再制作画面。已有剧本可在故事页检查并采用。',label:'去整理分镜',action:open(2) };
  else if (!imageDone) next = image.selected.length===image.total ? {title:'画面已选好，确认分镜',detail:'检查镜头顺序、时长与画面后，再制作视频。',label:p.step===2?'确认分镜，继续':'去确认分镜',action:confirmation(2)} : mediaNext('image',image,2,'分镜画面');
  else if (!videoDone) next = mediaNext('video',video,3,'镜头视频');
  else if (!voiceDone) next = mediaNext('voice',voice,4,'镜头旁白');
  else next = activeExports ? {title:'成片正在合成',detail:'使用现有选片合成，不重新生成素材。无需重复提交。',label:'查看成片进度',action:open(4)} : version.matched ? {title:'当前草稿已导出',detail:'画面、声音和字幕与已导出版本一致。可以预览下载，或继续编辑后导出新版本。',label:'查看成片',action:open(4)} : {title:exports?'继续检查或导出新版本':'准备导出你的短剧',detail:'先检查素材画幅、字幕与旁白时长。未启用配乐模型时，可上传音乐或保持无配乐。',label:p.step===4?'检查并导出':'去检查成片',action:p.step===4?{type:'export'}:open(4)};
  const pending = project.pendingRequests?.[0];
  if (videoDone && voiceDone && captionsNeedReview) next = {title:'字幕需要重新校正',detail:'旁白文字或音频已有修改，先核对字幕，再导出新版本。历史成片保留。',label:'去校正字幕',action:open(4)};
  if (pending) next = {title:'有已确认的请求尚未完整提交',detail:`剩余请求涉及 ${pending.count} 项。先检查并恢复原请求，避免创建另一批。`,label:'检查并恢复提交',action:{type:'resume',requestId:pending.id,count:pending.count}};
  return { stages, next, completed:stages.filter(s=>s.done).length, stale:image.stale+video.stale+voice.stale, active:candidates.filter(c=>['pending','running'].includes(c.status)).length, exports };
}
