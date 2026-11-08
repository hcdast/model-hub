import type { DramaCandidate, DramaKind, DramaPlan, DramaReference } from './drama.types';
import { imageInputNames } from './drama-experience';

export function shotReferences(plan: DramaPlan, kind: DramaKind, targetId: string): DramaReference[] {
  const shot = plan.shots.find(s => s.id === targetId);
  if (!shot || !['image', 'video'].includes(kind)) return [];
  if (kind === 'video') return shot.image ? [{ kind: 'image', targetId, candidateId: shot.image, name: shot.title || '分镜画面' }] : [];
  return [
    ...shot.characterIds.flatMap(id => {
      const role = plan.characters.find(r => r.id === id);
      return role?.selected ? [{ kind: 'character' as const, targetId: id, candidateId: role.selected, name: role.name }] : [];
    }),
    ...plan.scenes.filter(s => s.id === shot.sceneId && s.selected).map(s => ({ kind: 'scene' as const, targetId: s.id, candidateId: s.selected!, name: s.name })),
  ];
}

export interface ReferenceParam { name: string; type?: string; maxItems?: number; media?: { kind?: string } }
/** Prefer a declared multi-image input; never imply a scalar field can carry every role. */
export function referenceUsage(refs: DramaReference[], params: ReferenceParam[]) {
  const eligible = params.filter(p => imageInputNames.includes(p.name) || p.media?.kind === 'image');
  const field = eligible.find(p => p.type === 'array' && imageInputNames.includes(p.name))
    || eligible.find(p => p.type === 'array') || eligible.find(p => imageInputNames.includes(p.name)) || eligible[0];
  const capacity = !field ? 0 : field.type === 'array' ? Math.max(0, Math.floor(field.maxItems ?? refs.length)) : 1;
  return { field, used: refs.slice(0, capacity), omitted: refs.slice(capacity) };
}

/** Server builds reference inputs from owned selected candidates, then freezes the actual usage. */
export function applyShotReferences(plan: DramaPlan, kind: DramaKind, targetId: string, candidates: DramaCandidate[], params: ReferenceParam[], input: Record<string, unknown>) {
  const refs = shotReferences(plan, kind, targetId), usage = referenceUsage(refs, params);
  if (refs.length) for (const param of params) {
    if (param.name !== usage.field?.name && (imageInputNames.includes(param.name) || param.media?.kind === 'image')) delete input[param.name];
  }
  const urls = usage.used.map(ref => {
    const candidate = candidates.find(c => c.id === ref.candidateId && c.kind === ref.kind && c.targetId === ref.targetId && c.status === 'succeeded' && c.url);
    if (!candidate) throw new Error(`${ref.name}的参考图不可用，请重新选用`);
    return candidate.url!;
  });
  if (usage.field && urls.length) input[usage.field.name] = usage.field.type === 'array' ? urls : urls[0];
  const manualReferenceCount = !refs.length && ['image','video'].includes(kind) ? params.filter(p=>imageInputNames.includes(p.name) || p.media?.kind==='image').reduce((sum,p)=>{
    const values=Array.isArray(input[p.name]) ? input[p.name] as unknown[] : [input[p.name]];
    return sum+values.filter(v=>typeof v==='string' && v.trim()).length;
  },0) : 0;
  return {...usage,manualReferenceCount};
}

export function continuityRows(plan: DramaPlan, candidates: DramaCandidate[]) {
  return plan.shots.map((shot, index) => {
    const references = shotReferences(plan, 'image', shot.id);
    const missing = [
      ...shot.characterIds.flatMap(id => { const r = plan.characters.find(c => c.id === id); return r && !r.selected ? [r.name] : []; }),
      ...plan.scenes.filter(s => s.id === shot.sceneId && !s.selected).map(s => s.name),
    ];
    const image = candidates.find(c => c.id === shot.image && c.kind === 'image' && c.targetId === shot.id && c.status === 'succeeded' && c.url);
    const video = candidates.find(c => c.id === shot.video && c.kind === 'video' && c.targetId === shot.id && c.status === 'succeeded' && c.url);
    const stale = [image, video].filter((c): c is DramaCandidate => !!c?.stale);
    return { shot, index, references, missing, image, video, stale };
  });
}
