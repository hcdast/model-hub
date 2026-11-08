import { applyFrameInput, budgetSummary, frameDimensions, voiceBatchTargets } from './drama-production';
import { normalizeDramaPlan, srtText } from './drama-plan';
import { emptyDramaPlan } from './drama.types';

describe('Short drama production settings', () => {
  it('accepts an empty model preference map after MongoDB minimizes it', () => {
    expect(normalizeDramaPlan({ ...emptyDramaPlan(), production: { provider: 'akool-maas' } }).production).toEqual({ provider: 'akool-maas', models: {} });
    expect(() => normalizeDramaPlan({ ...emptyDramaPlan(), production: { provider: 'akool-maas', models: [] } })).toThrow('制作方案');
  });
  it('replaces conflicting square defaults with proportional portrait dimensions', () => {
    const input = { width: 2920, height: 2920 };
    applyFrameInput(input, { width: { min: 512, max: 4096 }, height: { min: 512, max: 4096 }, aspect_ratio: { enum: ['9:16'] } }, emptyDramaPlan(), {});
    expect(input.width / input.height).toBeCloseTo(9 / 16, 2);
    expect(input.height).toBeLessThanOrEqual(4096);
    expect(() => applyFrameInput({}, { aspect_ratio: { enum: ['1:1'] } }, emptyDramaPlan(), {})).toThrow('不支持');
  });
  it('preserves explicit dimensions and supports landscape rendering', () => {
    const input = { width: 1024, height: 1024 };
    applyFrameInput(input, { width: {}, height: {} }, emptyDramaPlan(), { width: 1024 });
    expect(input.width).toBe(1024);
    expect(frameDimensions({ ...emptyDramaPlan(), frame: { ratio: '16:9', fit: 'cover', voiceVolume: 80 } })).toEqual([1280, 720]);
  });
  it('validates fractional subtitle timing and excludes server-managed fields', () => {
    const p = { ...emptyDramaPlan(), frame: { ratio: '9:16' as const, fit: 'cover' as const, voiceVolume: 90 }, shots: [{ id: 's', title: '', description: '', narration: '你好', duration: 5, characterIds: [], trimStart: 1, subtitleStart: 0.5, subtitleEnd: 4.25 }] };
    const normalized = normalizeDramaPlan({ ...p, budgetLimit: 999, budgetHolds: [] });
    expect(normalized).not.toHaveProperty('budgetLimit');
    expect(srtText(normalized)).toContain('00:00:00,500 --> 00:00:04,250');
    expect(() => normalizeDramaPlan({ ...p, shots: [{ ...p.shots[0], subtitleEnd: 0.2 }] })).toThrow('字幕结束');
    expect(() => normalizeDramaPlan({ ...p, frame: { ...p.frame, voiceVolume: 999 } })).toThrow('音量');
  });
  it('separates settled spend, reserved credits and remaining authorization', () => {
    expect(budgetSummary({ budgetLimit: 100, budgetHolds: [{ quoteId: 'a', amount: 17, settled: true }, { quoteId: 'b', amount: 15, settled: false }] })).toEqual({ limit: 100, used: 17, reserved: 15, remaining: 68 });
  });
  it('persists bounded voice preferences and rejects nested or oversized payloads', () => {
    const p = { ...emptyDramaPlan(), production: { provider:'akool-maas', models:{}, voiceParameters:{voice:'warm',speed:1.1} } };
    expect(normalizeDramaPlan(p).production?.voiceParameters).toEqual({voice:'warm',speed:1.1});
    expect(()=>normalizeDramaPlan({...p,production:{...p.production,voiceParameters:{voice:{secret:'unsupported'}}}})).toThrow('配音设置');
  });
  it('never batches selected, blank, running or completed voices, and requires unambiguous current audio', () => {
    const shots = ['selected', 'blank', 'running', 'ready', 'multiple', 'stale', 'failed', 'missing'].map(id => ({ id, title: id, description: '', narration: id === 'blank' ? '  ' : '你好', duration: 5, characterIds: [], ...(id === 'selected' ? { voice: 'chosen' } : {}) }));
    const candidate = (targetId: string, id: string, status: 'running' | 'succeeded' | 'failed', stale = false) => ({ id, projectId: 'acceptance', targetId, kind: 'voice' as const, source: 'model' as const, status, stale });
    expect(voiceBatchTargets({ ...emptyDramaPlan(), shots }, [candidate('running', 'a', 'running'), candidate('ready', 'b', 'succeeded'), candidate('multiple', 'c', 'succeeded'), candidate('multiple', 'd', 'succeeded'), candidate('stale', 'e', 'succeeded', true), candidate('failed', 'f', 'failed')])).toEqual({ missing: ['stale', 'failed', 'missing'], ready: { ready: 'b' } });
  });
  it('limits each narration quote to twelve shots in story order', () => {
    const shots = Array.from({ length: 24 }, (_, i) => ({ id: String(i), title: '', description: '', narration: '你好', duration: 5, characterIds: [] }));
    expect(voiceBatchTargets({ ...emptyDramaPlan(), shots }, []).missing).toEqual(shots.slice(0, 12).map(s => s.id));
  });
});
