import { missingBatch, patchShotGroup, resumeStep, shotStatus } from './drama-workspace';
import { emptyDramaPlan, type DramaCandidate, type DramaProject, type DramaPlan } from './drama.types';

function fixture(): DramaProject {
  const plan:DramaPlan = { ...emptyDramaPlan(), story: '故事', storyConfirmed: true, castConfirmed: true, storyboardConfirmed: true, step: 0,
    characters: [{ id: 'role', name: '小雨', description: '风衣' }], shots: Array.from({ length: 16 }, (_, i) => ({ id: 's' + i, title: '镜头', description: '画面', narration: '旁白', duration: 5, characterIds: ['role'], image: 'i' + i })) };
  const candidates: DramaCandidate[] = plan.shots.map(s => ({ id: s.image!, projectId: 'p', kind: 'image', targetId: s.id, source: 'model', status: 'succeeded', url: 'https://example.com/image' }));
  return { id: 'p', revision: 1, plan, candidates };
}
describe('Short drama workspace scopes', () => {
  it('resumes from actual missing footage rather than the last viewed editor', () => { expect(resumeStep(fixture())).toBe(3); });
  it('excludes selected, running and reviewable takes from generation even when checked', () => {
    const p = fixture(); p.plan.shots[0]['video'] = 'v0';
    p.candidates.push(...[0, 1, 2].map(i => ({ id: 'v' + i, projectId: 'p', kind: 'video' as const, targetId: 's' + i, source: 'model' as const, status: i === 1 ? 'running' as const : 'succeeded' as const, url: 'https://example.com/video' })));
    expect(missingBatch(p.plan, p.candidates, 'video', ['s0', 's1', 's2', 's3'])).toEqual(['s3']);
    expect(shotStatus(p.plan, p.candidates, 'video', 's2')).toBe('review');
    expect(missingBatch(p.plan, p.candidates, 'video')).toHaveLength(12);
    expect(missingBatch(p.plan, p.candidates, 'video', [])).toEqual([]);
  });
  it('treats stale-only candidates as missing while preserving selected stale footage', () => {
    const p = fixture(); p.candidates[0].stale = true;
    expect(shotStatus(p.plan, p.candidates, 'image', 's0')).toBe('selected');
    p.plan.shots[0].image = undefined;
    expect(shotStatus(p.plan, p.candidates, 'image', 's0')).toBe('missing');
  });
  it('updates only the selected shots, clips cues, and preserves all selected media', () => {
    const p = fixture(); p.plan.shots[0]['captions'] = [{ start: 0, end: 5, text: '雨停了' }, { start: 4, end: 5, text: '末句' }];
    const next = patchShotGroup(p.plan, ['s0'], { duration: 3, characterIds: [] });
    expect(next.shots[0]).toMatchObject({ image: 'i0', duration: 3, characterIds: [], captions: [{ start: 0, end: 3, text: '雨停了' }] });
    expect(next.shots[1]).toEqual(p.plan.shots[1]); expect(next.storyboardConfirmed).toBe(false);
  });
  it('rejects a batch that would exceed episode duration instead of silently truncating it', () => {
    const p = fixture(); expect(() => patchShotGroup(p.plan, p.plan.shots.map(s => s.id), { duration: 15 })).toThrow('180');
    expect(() => patchShotGroup(p.plan, ['s0'], { duration: 1 })).toThrow('2–15');
  });
});
