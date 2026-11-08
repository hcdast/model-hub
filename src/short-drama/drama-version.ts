import type { DramaCandidate, DramaPlan } from './drama.types';
import { dramaSrt } from './drama-timing';

/** Only output inputs, never navigation, prompts, credentials or mutable asset URLs. */
export function renderManifest(plan: DramaPlan) {
  return {
    schema: 1 as const,
    shots: plan.shots.map(s => ({ id: s.id, video: s.video || '', voice: s.voice || '', duration: s.duration, trimStart: s.trimStart || 0 })),
    picture: { ratio: plan.frame?.ratio || '9:16', fit: plan.frame?.fit || 'contain', resolution: plan.settings.resolution },
    captions: { enabled: plan.settings.subtitles, style: plan.settings.subtitles ? plan.settings.subtitleStyle : '', srt: plan.settings.subtitles ? dramaSrt(plan) : '' },
    sound: { volume: plan.frame?.voiceVolume ?? 100, normalize: !!plan.settings.normalizeVoice, music: plan.settings.music || '',
      musicVolume: plan.settings.music ? plan.settings.musicVolume : 0, ducking: !!plan.settings.music && !!plan.settings.musicDucking },
  };
}
export type DramaRenderSource = { revision: number; manifest: ReturnType<typeof renderManifest> };
export function renderDifferences(plan: DramaPlan, source?: DramaRenderSource): string[] | undefined {
  if (!source || source.manifest?.schema !== 1) return undefined;
  const now = renderManifest(plan), old = source.manifest;
  const changed: string[] = [];
  if (JSON.stringify(now.shots) !== JSON.stringify(old.shots)) changed.push('镜头顺序、选片、时长或剪辑');
  if (JSON.stringify(now.picture) !== JSON.stringify(old.picture)) changed.push('画幅或清晰度');
  if (JSON.stringify(now.captions) !== JSON.stringify(old.captions)) changed.push('字幕内容或样式');
  if (JSON.stringify(now.sound) !== JSON.stringify(old.sound)) changed.push('旁白或配乐设置');
  return changed;
}
export function exportVersionState(plan: DramaPlan, candidates: DramaCandidate[]) {
  const exports = candidates.filter(c => c.kind === 'export' && c.status === 'succeeded' && c.url);
  const matched = [...exports].reverse().find(c => renderDifferences(plan, c.renderSource)?.length === 0);
  const latest = exports[exports.length - 1];
  return { exports, matched, latest, status: matched ? 'current' as const : !latest ? 'none' as const
    : renderDifferences(plan, latest.renderSource) === undefined ? 'unknown' as const : 'changed' as const };
}
