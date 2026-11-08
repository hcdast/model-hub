import type { DramaCandidate, DramaKind, DramaPlan } from './drama.types';

export const imageInputNames = ['image', 'images', 'image_url', 'image_urls', 'reference_images', 'start_image'];
/** The same model duration policy is used for preflight, billing and the UI. */
export function generationDuration(desired: number, def: { enum?: unknown[]; min?: number; max?: number; type?: string }) {
  const choices = def.enum?.map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a,b) => a-b);
  const value = choices?.length ? choices.find(n => n >= desired) ?? choices[choices.length - 1] : Math.min(def.max ?? desired, Math.max(def.min ?? 0, desired));
  return def.type === 'string' ? String(value) : value;
}
export function referenceIds(plan: DramaPlan, kind: DramaKind, targetId: string): string[] {
  const shot = plan.shots.find(s => s.id === targetId);
  if (kind === 'video') return shot?.image ? [shot.image] : [];
  if (kind !== 'image' || !shot) return [];
  return [...shot.characterIds.map(id => plan.characters.find(c => c.id === id)?.selected), plan.scenes.find(s => s.id === shot.sceneId)?.selected].filter((id): id is string => !!id);
}
export function systemGenerationField(name: string, kind: DramaKind, hasReferences: boolean, mediaKind?: string) {
  return ['prompt','text','duration', ...(['character','scene','image','video'].includes(kind) ? ['aspect_ratio','width','height'] : [])].includes(name)
    || hasReferences && (mediaKind === 'image' || imageInputNames.includes(name));
}
/** Failed candidates are history when a target is selected, ready or already retrying. */
export function failedProduction(plan: DramaPlan, candidates: DramaCandidate[]) {
  const retry: Array<{ kind: DramaKind; ids: string[] }> = [];
  const failures = candidates.filter(c => c.status === 'failed');
  const selected = (kind: DramaKind, targetId: string) => kind === 'script' ? plan.storyConfirmed : kind === 'character' || kind === 'scene'
    ? (kind === 'character' ? plan.characters : plan.scenes).find(c => c.id === targetId)?.selected
    : kind === 'music' ? plan.settings.music : plan.shots.find(s => s.id === targetId)?.[kind as 'image'|'video'|'voice'];
  let actionable = 0;
  for (const kind of ['script','character','scene','image','video','voice','music','export'] as DramaKind[]) {
    const ids = [...new Set(failures.filter(c => c.kind === kind).map(c => c.targetId))].filter(id => {
      const exists = ['script','music','export'].includes(kind) ? id === 'project' : (kind === 'character' ? plan.characters : kind === 'scene' ? plan.scenes : plan.shots).some(s => s.id === id);
      return exists && !selected(kind,id) && !candidates.some(c => c.kind === kind && c.targetId === id && (['pending','running'].includes(c.status) || c.status === 'succeeded' && !c.stale && !!(kind==='script' ? c.text : c.url)));
    });
    if (ids.length) { actionable += ids.length; retry.push({ kind, ids }); }
  }
  return { total: failures.length, actionable, retry };
}
