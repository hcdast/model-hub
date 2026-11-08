import { dramaSrt, fitVoiceTiming, voiceOverflows } from './drama-timing';
import { emptyDramaPlan, DramaPlan } from './drama.types';
import { normalizeDramaPlan } from './drama-plan';

const plan = (): DramaPlan => ({ ...emptyDramaPlan(), shots: [
  { id: 'a', title: '无旁白', description: '', narration: '', duration: 3, characterIds: [] },
  { id: 'b', title: '来信', description: '', narration: '你好。', duration: 5, characterIds: [], voice: 'voice', video: 'video' },
] });
describe('Narration timing and captions', () => {
  it('extends only matching selected speech, retains selected video and manual subtitle windows', () => {
    const p = plan(); p.shots[1].subtitleStart = 1; p.shots[1].subtitleEnd = 4;
    const fitted = fitVoiceTiming(p, [{ shotId: 'b', voiceId: 'voice', seconds: 7.1 }]);
    expect(fitted.shots[0]).toBe(p.shots[0]);
    expect(fitted.shots[1]).toMatchObject({ duration: 8, voice: 'voice', video: 'video', subtitleStart: 1, subtitleEnd: 4 });
    expect(fitted.storyboardConfirmed).toBe(false);
    expect(p.shots[1].duration).toBe(5);
    expect(fitVoiceTiming(p, [{ shotId: 'b', voiceId: 'old-voice', seconds: 20 }]).shots[1]).toBe(p.shots[1]);
  });
  it('keeps default caption end with an extension and rejects the per-shot and episode limits', () => {
    const p = plan(); expect(fitVoiceTiming(p, [{ shotId: 'b', voiceId: 'voice', seconds: 7 }]).shots[1].subtitleEnd).toBe(7);
    expect(() => fitVoiceTiming(p, [{ shotId: 'b', voiceId: 'voice', seconds: 15.4 }])).toThrow('15 秒');
    p.shots = Array.from({ length: 12 }, (_, i) => ({ ...p.shots[1], id: `s${i}`, duration: 15 }));
    p.shots.push({ ...p.shots[0], id: 'extra', duration: 2 });
    expect(() => fitVoiceTiming(p, [])).toThrow('180 秒');
    expect(voiceOverflows(5, 5.3)).toBe(false); expect(voiceOverflows(5, 5.31)).toBe(true);
  });
  it('does not emit empty captions and keeps silence in the elapsed timeline', () => {
    const p = plan(); p.shots[1].subtitleStart = 0.5; p.shots[1].subtitleEnd = 4;
    expect(dramaSrt(p)).toBe('1\n00:00:03,500 --> 00:00:07,000\n你好。\n');
  });
  it('round-trips optional audio switches without changing legacy plans', () => {
    expect(normalizeDramaPlan(plan()).settings).not.toHaveProperty('normalizeVoice');
    expect(normalizeDramaPlan({ ...plan(), settings: { ...plan().settings, normalizeVoice: true, musicDucking: true } }).settings).toMatchObject({ normalizeVoice: true, musicDucking: true });
    expect(() => normalizeDramaPlan({ ...plan(), settings: { ...plan().settings, normalizeVoice: 'true' } })).toThrow('开关值');
  });
});
