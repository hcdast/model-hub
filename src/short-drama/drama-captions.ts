import type { DramaCaption, DramaShot } from './drama.types';

export interface SpeechWindow { start: number; end: number }
export interface CaptionAnalysis { shotId: string; voiceId?: string; seconds?: number; windows?: SpeechWindow[]; error?: string }
export interface CaptionReport { projectId: string; revision: number; voices: CaptionAnalysis[] }
/** Prefer sentence boundaries, then punctuation/space; hard-wrap long CJK text. */
export function captionSentences(text: string): string[] {
  const phrases = text.replace(/\r/g,'').match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [];
  return phrases.flatMap(phrase => {
    const result: string[] = []; let line = '';
    for (const token of phrase.trim().match(/[^，,、\s]+[，,、]?|\s+/gu) || []) {
      if (Array.from(line + token).length > 22 && line.trim()) { result.push(line.trim()); line = ''; }
      for (const char of token) { line += char; if (Array.from(line).length >= 22) { result.push(line.trim()); line = ''; } }
    }
    if (line.trim()) result.push(line.trim()); return result;
  }).filter(Boolean);
}
/** This is pause-assisted estimation, not ASR or word recognition. No speech is altered. */
export function estimateCaptions(shot: DramaShot, analysis?: CaptionAnalysis): DramaCaption[] {
  let parts = captionSentences(shot.narration);
  if (!parts.length) return [];
  const start = shot.subtitleStart || 0, end = Math.min(shot.subtitleEnd ?? shot.duration, analysis?.seconds ?? shot.duration, shot.duration);
  if (end <= start) throw new Error('字幕范围没有覆盖旁白，请调整开始和结束时间');
  const windows = (analysis?.windows || [{ start, end }]).map(w => ({ start: Math.max(start,w.start),end:Math.min(end,w.end) })).filter(w => w.end > w.start);
  if (!windows.length) throw new Error('没有检测到可用语音，请试听后手动调整字幕');
  const duration = windows.reduce((n,w) => n+w.end-w.start,0);
  const limit=Math.max(1,Math.min(80,Math.floor(duration/0.08)));
  if(parts.length>limit) {const groups=Array.from({length:limit},()=> '');parts.forEach((text,i)=>{groups[Math.min(limit-1,Math.floor(i*limit/parts.length))]+=text;});parts=groups;}
  const weights = parts.map(text => Math.max(1,Array.from(text).filter(c=> !/[\p{P}\s]/u.test(c)).length));
  const total = weights.reduce((a,b)=>a+b,0);
  const locate = (position: number, endBoundary = false) => {
    let elapsed = 0;
    for (let i=0;i<windows.length;i++) { const w=windows[i], length=w.end-w.start;
      if (position < elapsed+length-1e-7 || endBoundary && position <= elapsed+length+1e-7 || i===windows.length-1) return w.start+Math.min(length,Math.max(0,position-elapsed));
      elapsed += length;
    }
    return end;
  };
  let elapsed = 0;
  return parts.map((text,i) => { const from=elapsed; elapsed += duration*weights[i]/total;
    return { text,start:Math.round(locate(from)*1000)/1000,end:Math.round(locate(elapsed,true)*1000)/1000 };
  });
}
export function captionsStale(shot: DramaShot) {
  return !!shot.captions && !!shot.captionSource && (shot.captionSource.narration !== shot.narration || shot.captionSource.voiceId !== shot.voice);
}
/** Legacy drafts keep one shot caption; new drafts explicitly opt into split cues. */
export function shotCaptions(shot: DramaShot): DramaCaption[] {
  if (shot.captions !== undefined) return shot.captions;
  return shot.narration.trim() ? [{start:shot.subtitleStart || 0,end:shot.subtitleEnd ?? shot.duration,text:shot.narration.replace(/\r/g,'').trim()}] : [];
}
export function parseSpeechWindows(log: string, seconds: number): SpeechWindow[] {
  const windows: SpeechWindow[] = []; let silenceStart: number | undefined, cursor=0;
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const t = Math.min(seconds,Math.max(0,Number(match[2])));
    if (match[1] === 'start') { silenceStart=t; if (t>cursor) windows.push({start:cursor,end:t}); }
    else if (silenceStart !== undefined) { cursor=t; silenceStart=undefined; }
  }
  if (silenceStart === undefined && cursor<seconds) windows.push({start:cursor,end:seconds});
  return windows;
}
