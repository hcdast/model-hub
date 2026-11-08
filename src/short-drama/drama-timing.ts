import type { DramaPlan } from './drama.types';
import { shotCaptions } from './drama-captions';

export interface DramaVoiceTiming {
  shotId: string;
  voiceId?: string;
  seconds?: number;
  error?: string;
}
export interface DramaTimingReport { projectId: string; revision: number; voices: DramaVoiceTiming[] }

export function voiceOverflows(duration: number, seconds?: number) {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > duration + 0.3;
}

/** Propose only safe extensions. Never shorten a cut, truncate speech or change selections. */
export function fitVoiceTiming(plan: DramaPlan, voices: DramaVoiceTiming[]): DramaPlan {
  const shots = plan.shots.map(shot => {
    const timing = voices.find(v => v.shotId === shot.id && v.voiceId === shot.voice);
    if (timing?.error) throw new Error('请先重新检查无法读取的旁白');
    if (!voiceOverflows(shot.duration, timing?.seconds)) return shot;
    const duration = Math.ceil(timing!.seconds!);
    if (duration > 15) throw new Error('有旁白超过单镜头 15 秒，请缩短旁白或拆分镜头后重新配音');
    return { ...shot, duration, subtitleEnd: shot.subtitleEnd === undefined || shot.subtitleEnd === shot.duration ? duration : shot.subtitleEnd };
  });
  if (shots.reduce((sum, shot) => sum + shot.duration, 0) > 180) throw new Error('延长后超过单集 180 秒，请缩短旁白或减少镜头');
  return { ...plan, shots, storyboardConfirmed: false };
}

/** Shared cue timeline used by preview/download and the frozen FFmpeg export. */
export function dramaSrt(plan: DramaPlan): string {
  const time = (n: number) => {
    const ms = Math.round(n * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  let elapsed = 0, index = 0;
  return plan.shots.flatMap(shot => {
    const start = elapsed; elapsed += shot.duration;
    return shotCaptions(shot).map(cue => `${++index}\n${time(start + cue.start)} --> ${time(start + cue.end)}\n${cue.text.trim()}\n`);
  }).join('\n');
}
