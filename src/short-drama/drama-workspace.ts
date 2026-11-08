import type { DramaCandidate, DramaPlan, DramaProject } from './drama.types';
import { dramaGuide, guideMedia, type GuideMediaKind } from './drama-guide';

export function shotStatus(plan: DramaPlan, candidates: DramaCandidate[], kind: GuideMediaKind, id: string): 'selected'|'working'|'review'|'missing' {
  const media = guideMedia(plan, candidates, kind);
  return media.selected.includes(id) ? 'selected' : media.working.includes(id) ? 'working'
    : media.ready.some(c => c.targetId === id) || media.review.includes(id) ? 'review' : 'missing';
}

/** Always derive the scope again. A checked row is not permission to replace an existing take. */
export function missingBatch(plan: DramaPlan, candidates: DramaCandidate[], kind: GuideMediaKind, selected?: string[]) {
  const missing = guideMedia(plan, candidates, kind).missing;
  return missing.filter(id => selected === undefined || selected.includes(id)).slice(0, 12);
}

export function resumeStep(project: DramaProject) {
  const action = dramaGuide(project).next.action;
  if (action.type === 'open' || action.type === 'confirm') return action.step;
  if (action.type === 'generate' || action.type === 'select') return action.kind === 'image' ? 2 : action.kind === 'video' ? 3 : 4;
  if (action.type === 'export') return 4;
  return project.plan.step;
}

export function patchShotGroup(plan: DramaPlan, ids: string[], patch: { characterIds?: string[]; sceneId?: string; duration?: number }) {
  if (patch.duration !== undefined && (!Number.isInteger(patch.duration) || patch.duration < 2 || patch.duration > 15)) throw new Error('镜头时长应为 2–15 秒整数');
  const shots = plan.shots.map(shot => {
    if (!ids.includes(shot.id)) return shot;
    const next = { ...shot, ...patch };
    if (patch.duration !== undefined) {
      next.subtitleEnd = Math.min(next.subtitleEnd ?? patch.duration, patch.duration);
      next.subtitleStart = Math.max(0, Math.min(next.subtitleStart || 0, next.subtitleEnd - 0.1));
      if (next.captions) next.captions = next.captions.map(c => ({ ...c, end: Math.min(c.end, patch.duration!) })).filter(c => c.end - c.start >= 0.03);
    }
    return next;
  });
  if (shots.reduce((sum, shot) => sum + shot.duration, 0) > 180) throw new Error('每集总时长不能超过 180 秒，请缩小调整范围');
  return { ...plan, shots, storyboardConfirmed: false };
}
