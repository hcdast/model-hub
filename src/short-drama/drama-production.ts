import type { DramaCandidate, DramaKind, DramaPlan } from './drama.types';

/** Batch only missing narration; choosing finished audio remains an explicit user action. */
export function voiceBatchTargets(plan: DramaPlan, candidates: DramaCandidate[]) {
  const missing: string[] = [], ready: Record<string, string> = {};
  for (const shot of plan.shots) {
    if (!shot.narration.trim() || shot.voice) continue;
    const voices = candidates.filter(c => c.kind === 'voice' && c.targetId === shot.id);
    if (voices.some(c => c.status === 'pending' || c.status === 'running')) continue;
    const completed = voices.filter(c => c.status === 'succeeded' && !c.stale);
    if (completed.length === 1) ready[shot.id] = completed[0].id;
    if (!completed.length) missing.push(shot.id);
  }
  return { missing: missing.slice(0, 12), ready };
}

export const DRAMA_KINDS: DramaKind[] = ['script', 'character', 'scene', 'image', 'video', 'voice', 'music'];
export function productionSettings(value: any): Pick<DramaPlan, 'production' | 'frame'> {
  const result: Pick<DramaPlan, 'production' | 'frame'> = {};
  if (value.production !== undefined) {
    const p = value.production;
    if (!p || !/^[\w-]{1,80}$/.test(p.provider) || (p.models !== undefined && (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)))) throw new Error('制作方案格式不正确');
    // MongoDB may omit empty objects; an unconfigured production plan remains editable.
    const configured = p.models || {};
    const models = Object.fromEntries(DRAMA_KINDS.filter(k => configured[k] !== undefined).map(k => {
      if (!/^[a-f\d]{24}$/i.test(configured[k])) throw new Error('制作方案模型配置不正确');
      return [k, configured[k]];
    }));
    result.production = { provider: p.provider, models };
    if (p.providers !== undefined) {
      if (!p.providers || typeof p.providers !== 'object' || Array.isArray(p.providers) || Object.keys(p.providers).some(k => !DRAMA_KINDS.includes(k as DramaKind))) throw new Error('制作供应商配置不正确');
      result.production.providers = Object.fromEntries(Object.entries(p.providers).filter(([, v]) => v !== undefined).map(([k, v]) => {
        if (typeof v !== 'string' || !/^[\w-]{1,80}$/.test(v)) throw new Error('制作供应商配置不正确');
        return [k, v];
      }));
    }
    if (p.voiceParameters !== undefined) {
      const values = p.voiceParameters;
      const scalar = (v: unknown) => typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 2000;
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 30 || JSON.stringify(values).length > 8000 || Object.entries(values).some(([key, v]) => !/^[\w-]{1,80}$/.test(key) || !scalar(v) && !(Array.isArray(v) && v.length <= 20 && v.every(scalar)))) throw new Error('配音设置格式不正确，请重新选择音色或调整参数');
      result.production.voiceParameters = { ...values };
    }
  }
  if (value.frame !== undefined) {
    const f = value.frame;
    if (!f || !['9:16', '16:9', '1:1'].includes(f.ratio) || !['contain', 'cover'].includes(f.fit) || !Number.isInteger(f.voiceVolume) || f.voiceVolume < 0 || f.voiceVolume > 200) throw new Error('画幅或旁白音量设置不正确');
    result.frame = { ratio: f.ratio, fit: f.fit, voiceVolume: f.voiceVolume };
  }
  return result;
}

/** Names are presentation metadata; changes to appearance and selected references affect production. */
export const roleInputs = (plan: DramaPlan) => [plan.characters, plan.scenes].map(list => list.map(r => ({ id: r.id, description: r.description, selected: r.selected })));
export function frameDimensions(plan: DramaPlan): [number, number] {
  const short = plan.settings.resolution === '1080p' ? 1080 : 720;
  const long = plan.settings.resolution === '1080p' ? 1920 : 1280;
  return plan.frame?.ratio === '16:9' ? [long, short] : plan.frame?.ratio === '1:1' ? [short, short] : [short, long];
}

/** Align width/height with aspect ratio instead of sending contradictory square defaults. */
export function applyFrameInput(input: Record<string, any>, params: Record<string, any>, plan: DramaPlan, overrides: Record<string, unknown>) {
  const ratio = plan.frame?.ratio || '9:16';
  if (params.aspect_ratio && overrides.aspect_ratio === undefined) {
    if (params.aspect_ratio.enum && !params.aspect_ratio.enum.includes(ratio)) throw new Error(`此模型不支持 ${ratio} 画幅，请选择兼容方案`);
    input.aspect_ratio = ratio;
  }
  if (params.width && params.height && overrides.width === undefined && overrides.height === undefined) {
    const [rw, rh] = ratio.split(':').map(Number);
    const originalArea = Number(input.width || 1024) * Number(input.height || 1024);
    const minW = params.width.min || 64, minH = params.height.min || 64;
    const maxW = params.width.max || 4096, maxH = params.height.max || 4096;
    const scale = Math.min(Math.sqrt(originalArea / (rw * rh)), maxW / rw, maxH / rh);
    input.width = Math.max(minW, Math.floor(rw * scale / 8) * 8);
    input.height = Math.max(minH, Math.floor(rh * scale / 8) * 8);
    if (Math.abs(input.width / input.height - rw / rh) > 0.03) throw new Error('模型尺寸限制与作品画幅不兼容');
  }
}

export function budgetSummary(project: any) {
  const holds: Array<{ amount: number; settled: boolean }> = project.budgetHolds || [];
  const sum = (settled: boolean) => Math.round(holds.filter(h => h.settled === settled).reduce((n, h) => n + h.amount, 0) * 1e6) / 1e6;
  const used = sum(true), reserved = sum(false), limit = project.budgetLimit ?? 0;
  return { limit, used, reserved, remaining: Math.max(0, Math.round((limit - used - reserved) * 1e6) / 1e6) };
}
