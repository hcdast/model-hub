import type { DramaPlan } from './drama.types';
import { frameDimensions } from './drama-production';
export interface VisualMeasure { width: number; height: number; seconds?: number }
export interface DramaVisualEntry extends Partial<VisualMeasure> { shotId: string; candidateId: string; kind: 'image'|'video'; error?: string }
export interface DramaVisualReport { projectId: string; revision: number; entries: DramaVisualEntry[] }
export function visualWarnings(plan: DramaPlan, entry: DramaVisualEntry) {
  if (entry.error || !entry.width || !entry.height) return [entry.error || '素材尺寸尚未确认'];
  const [width,height] = frameDimensions(plan), mismatch=Math.abs(entry.width/entry.height/(width/height)-1)>0.03;
  const scale=plan.frame?.fit==='cover' ? Math.max(width/entry.width,height/entry.height) : Math.min(width/entry.width,height/entry.height);
  return [ ...(mismatch ? [plan.frame?.fit==='cover' ? '画幅不一致，将居中裁切，请检查人物和文字' : '画幅不一致，将保留完整画面并留边'] : []), ...(scale>1.03 ? [`源素材分辨率较低，导出时约放大 ${scale.toFixed(1)} 倍，不会增加原生细节`] : []) ];
}
