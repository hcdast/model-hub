import type { DramaCaption } from '../../../src/short-drama/drama.types';
export const captionDraftKey=(owner:string|undefined,projectId:string,shotId:string)=>`short-drama-caption:${owner}:${projectId}:${shotId}`;
export function readCaptionDraft(key:string):DramaCaption[]|undefined {
  try { const value=JSON.parse(localStorage.getItem(key) || 'null');
    if(Array.isArray(value) && value.length<=80 && value.every(c=>c && typeof c.text==='string' && c.text.length<=2000 && Number.isFinite(c.start) && Number.isFinite(c.end))) return value;
  } catch { /* Local draft storage is optional. */ }
  return undefined;
}
