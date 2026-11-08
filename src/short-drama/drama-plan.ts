import { createHash } from 'crypto';
import { DramaKind, DramaPlan, DramaCandidate, DramaShot, DramaRole, DRAMA_STYLES, emptyDramaPlan } from './drama.types';
import { productionSettings } from './drama-production';
import { captionsStale } from './drama-captions';

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('作品数据格式不正确');
  return value as Record<string, any>;
}
function text(value: unknown, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error(`文字长度不能超过 ${max} 字`);
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`数值必须在 ${min}–${max} 之间`);
  return value as number;
}
function id(value: unknown): string { const s = text(value, 64); if (!/^[\w-]{1,64}$/.test(s)) throw new Error('条目 ID 不正确'); return s; }
function selected(value: unknown): string | undefined { return value == null || value === '' ? undefined : id(value); }
function roles(value: unknown): DramaRole[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('角色或场景最多 8 个');
  return value.map(v => { const r = record(v), candidate = selected(r.selected); return { id: id(r.id), name: text(r.name, 60), description: text(r.description, 2000), ...(candidate ? { selected: candidate } : {}) }; });
}
/** Whitelist all editable fields; clients cannot write tasks, URLs, ownership or revision. */
export function normalizeDramaPlan(value: unknown): DramaPlan {
  const r = record(value), settings = record(r.settings), defaults = emptyDramaPlan();
  let guide: DramaPlan['guide'];
  if (r.guide !== undefined) {
    const g = record(r.guide);
    if (typeof g.paused !== 'boolean' || typeof g.narration !== 'boolean') throw new Error('制作引导设置必须为开关值');
    guide = { paused: g.paused, narration: g.narration };
  }
  for (const key of ['normalizeVoice', 'musicDucking']) if (settings[key] !== undefined && typeof settings[key] !== 'boolean') throw new Error('声音设置必须为开关值');
  if (!Array.isArray(r.shots) || r.shots.length > 24) throw new Error('首版每集最多 24 个镜头');
  const characters = roles(r.characters), scenes = roles(r.scenes);
  const shots: DramaShot[] = r.shots.map((v: unknown) => {
    const s = record(v);
    if (!Array.isArray(s.characterIds) || s.characterIds.length > 8 || s.characterIds.some((x: unknown) => !characters.some(c => c.id === x))) throw new Error('镜头引用了不存在的角色');
    const sceneId = selected(s.sceneId);
    if (sceneId && !scenes.some(x => x.id === sceneId)) throw new Error('镜头引用了不存在的场景');
    const image = selected(s.image), video = selected(s.video), voice = selected(s.voice);
    const timing: Partial<DramaShot> = {};
    for (const key of ['trimStart', 'subtitleStart', 'subtitleEnd'] as const) if (s[key] !== undefined) {
      if (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < 0 || s[key] > (key === 'trimStart' ? 180 : s.duration)) throw new Error('镜头裁剪或字幕时间不正确');
      timing[key] = s[key];
    }
    if ((timing.subtitleEnd ?? s.duration) <= (timing.subtitleStart ?? 0)) throw new Error('字幕结束时间必须晚于开始时间');
    if (s.captions !== undefined) {
      if (!Array.isArray(s.captions) || s.captions.length > 80) throw new Error('每镜头最多 80 段字幕');
      let previousEnd = 0;
      timing.captions = s.captions.map((value: unknown) => {
        const cue = record(value), caption = text(cue.text, 2000).trim();
        if (!caption || typeof cue.start !== 'number' || typeof cue.end !== 'number' || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.start < 0 || cue.end > s.duration || cue.end - cue.start < 0.03) throw new Error('字幕时间需按顺序排列、不重叠，且位于镜头内（每段至少 0.03 秒）');
        previousEnd = cue.end; return {start:cue.start,end:cue.end,text:caption};
      });
      if (timing.captions.reduce((n,c) => n+c.text.length,0)>4000) throw new Error('镜头字幕总长度不能超过 4000 字');
      if (s.captionSource !== undefined) {
        const source=record(s.captionSource);
        if (!['estimated','pause','manual'].includes(source.method)) throw new Error('字幕来源不正确');
        timing.captionSource={narration:text(source.narration,2000), ...(selected(source.voiceId) ? {voiceId:selected(source.voiceId)} : {}),method:source.method};
      }
    }
    return { id: id(s.id), title: text(s.title, 100), description: text(s.description, 3000), narration: text(s.narration, 2000), duration: integer(s.duration, 2, 15),
      ...timing,
      characterIds: s.characterIds.map(id), ...(sceneId ? { sceneId } : {}), ...(image ? { image } : {}), ...(video ? { video } : {}), ...(voice ? { voice } : {}) };
  });
  for (const list of [characters, scenes, shots]) if (new Set(list.map(x => x.id)).size !== list.length) throw new Error('条目 ID 不能重复');
  if (shots.reduce((n, s) => n + s.duration, 0) > 180) throw new Error('首版每集总时长不超过 180 秒');
  return { title: text(r.title, 100, defaults.title).trim() || defaults.title, story: text(r.story, 12000), inputMode: r.inputMode === 'script' ? 'script' : 'idea',
    ...productionSettings(r), ...(guide ? { guide } : {}),
    style: DRAMA_STYLES.includes(r.style) ? r.style : defaults.style, duration: integer(r.duration, 15, 180), step: integer(r.step, 0, 4),
    storyConfirmed: r.storyConfirmed === true, castConfirmed: r.castConfirmed === true, storyboardConfirmed: r.storyboardConfirmed === true,
    characters, scenes, shots, settings: { subtitles: settings.subtitles !== false, subtitleStyle: settings.subtitleStyle === 'warm' ? 'warm' : 'white',
      musicVolume: integer(settings.musicVolume, 0, 100), ...(selected(settings.music) ? { music: selected(settings.music) } : {}), resolution: settings.resolution === '1080p' ? '1080p' : '720p',
      ...(settings.normalizeVoice !== undefined ? { normalizeVoice: settings.normalizeVoice } : {}), ...(settings.musicDucking !== undefined ? { musicDucking: settings.musicDucking } : {}) } };
}
export function selectedReferences(plan: DramaPlan): Array<{ id: string; kind: DramaKind; targetId: string }> {
  return [
    ...plan.characters.filter(x => x.selected).map(x => ({ id: x.selected!, kind: 'character' as const, targetId: x.id })),
    ...plan.scenes.filter(x => x.selected).map(x => ({ id: x.selected!, kind: 'scene' as const, targetId: x.id })),
    ...plan.shots.flatMap(s => (['image', 'video', 'voice'] as const).filter(k => s[k]).map(k => ({ id: s[k]!, kind: k, targetId: s.id }))),
    ...(plan.settings.music ? [{ id: plan.settings.music, kind: 'music' as const, targetId: 'project' }] : []),
  ];
}
export function validateSelections(plan: DramaPlan, candidates: DramaCandidate[]): void {
  for (const ref of selectedReferences(plan)) if (!candidates.some(c => c.id === ref.id && c.kind === ref.kind && c.targetId === ref.targetId && c.status === 'succeeded' && c.url)) throw new Error('选用素材不存在、尚未完成或不属于当前条目');
  if (plan.storyConfirmed && !plan.story.trim()) throw new Error('先填写故事再确认');
  if (plan.castConfirmed && (!plan.storyConfirmed || !plan.characters.length || plan.characters.some(x => !x.name.trim() || !x.description.trim()))) throw new Error('先确认故事，并完善角色设定');
  if (plan.storyboardConfirmed && (!plan.castConfirmed || !plan.shots.length || plan.shots.some(s => !s.description.trim() || !s.image))) throw new Error('先确认角色，并为每个镜头选用画面');
}
export function validateCaptionSources(plan: DramaPlan) {
  if (plan.settings.subtitles && plan.shots.some(captionsStale)) throw new Error('旁白文字或音频已有修改，请重新生成分句字幕或确认手动校正后再导出');
}
/** Store a fingerprint to expose stale shots after a story/role/shot edit. */
export function shotFingerprint(plan: DramaPlan, targetId: string): string {
  const shot = plan.shots.find(s => s.id === targetId);
  return createHash('sha256').update(JSON.stringify({ style: plan.style, shot: shot && { description: shot.description, duration: shot.duration, image: shot.image },
    characters: shot?.characterIds.map(x => { const r = plan.characters.find(c => c.id === x); return r && { id: r.id, description: r.description, selected: r.selected }; }), scene: (() => { const r = plan.scenes.find(s => s.id === shot?.sceneId); return r && { id: r.id, description: r.description, selected: r.selected }; })(), ratio: plan.frame?.ratio || '9:16' })).digest('hex');
}
export function dramaFingerprint(plan: DramaPlan, kind: DramaKind, targetId: string): string {
  if (kind === 'video') return shotFingerprint(plan, targetId);
  if (kind === 'image') return shotFingerprint({ ...plan, shots: plan.shots.map(s => s.id === targetId ? { ...s, image: undefined } : s) }, targetId);
  const narration = plan.shots.find(s => s.id === targetId)?.narration;
    const voiceInput = plan.production?.models?.voice || plan.production?.voiceParameters || plan.production?.providers?.voice ? { narration, model: plan.production?.models?.voice, provider: plan.production?.providers?.voice || plan.production?.provider, parameters: plan.production?.voiceParameters } : narration;
  const payload = kind === 'voice' ? voiceInput : kind === 'character' ? plan.characters.find(c => c.id === targetId) : kind === 'scene' ? plan.scenes.find(s => s.id === targetId) : { story: plan.story, style: plan.style, duration: plan.duration };
  const withoutSelection = payload && typeof payload === 'object' ? Object.fromEntries(Object.entries(payload).filter(([key]) => !['selected', 'name'].includes(key))) : payload;
  return createHash('sha256').update(JSON.stringify(withoutSelection) || '').digest('hex');
}
export { dramaSrt as srtText } from './drama-timing';
/** Only schema-declared fields, known result envelopes and text are interpreted as output. */
export function readDramaOutput(result: unknown, media: 'image' | 'video' | 'audio' | 'text', schema?: any): { url?: string; text?: string } {
  const urls: string[] = [], texts: string[] = [];
  const visit = (v: any, def: any, depth: number) => {
    if (depth > 8 || v == null || def?.hide) return;
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v) && (!def?.media || def.media.kind === media)) urls.push(v);
      else if (media === 'text') texts.push(v);
    } else if (Array.isArray(v)) v.forEach(x => visit(x, def?.items, depth + 1));
    else if (typeof v === 'object') {
      if (media === 'text' && Array.isArray(v.shots) && Array.isArray(v.characters)) { texts.push(JSON.stringify(v)); return; }
      if (media === 'text' && Array.isArray(v.choices)) { visit(v.choices[0]?.message?.content, undefined, depth + 1); return; }
      if (def?.properties) Object.entries(def.properties).forEach(([k, d]) => visit(v[k], d, depth + 1));
      else ['result', 'output', 'data', 'url', 'urls', 'images', 'image', 'videos', 'video', 'audio', 'text', 'content', 'choices', 'message'].forEach(k => { if (k in v) visit(v[k], undefined, depth + 1); });
    }
  };
  visit(result, schema, 0);
  const text = texts.join('\n');
  return media === 'text' ? { text: text && text.length <= 100000 ? text : undefined } : { url: urls[0] };
}
