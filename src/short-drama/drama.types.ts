/** Shared product contract. Keep this file independent of Nest and browser APIs. */
export type DramaKind = 'script' | 'character' | 'scene' | 'image' | 'video' | 'voice' | 'music' | 'export';
export interface DramaRole { id: string; name: string; description: string; selected?: string }
export interface DramaShot {
  id: string; title: string; description: string; narration: string; duration: number;
  characterIds: string[]; sceneId?: string; image?: string; video?: string; voice?: string;
  trimStart?: number; subtitleStart?: number; subtitleEnd?: number;
  captions?: DramaCaption[];
  captionSource?: { narration: string; voiceId?: string; method: 'estimated' | 'pause' | 'manual' };
}
export interface DramaCaption { start: number; end: number; text: string }
export interface DramaPlan {
  title: string; story: string; inputMode: 'idea' | 'script'; style: string; duration: number;
  step: number; storyConfirmed: boolean; castConfirmed: boolean; storyboardConfirmed: boolean;
  characters: DramaRole[]; scenes: DramaRole[]; shots: DramaShot[];
  guide?: { paused: boolean; narration: boolean };
  production?: { provider: string; providers?: Partial<Record<DramaKind, string>>; models: Partial<Record<DramaKind, string>>; voiceParameters?: Record<string, unknown> };
  settings: { subtitles: boolean; subtitleStyle: 'white' | 'warm'; musicVolume: number; music?: string; resolution: '720p' | '1080p'; normalizeVoice?: boolean; musicDucking?: boolean };
  // Optional for legacy plans; normalized and checked by the service.
  frame?: { ratio: '9:16' | '16:9' | '1:1'; fit: 'contain' | 'cover'; voiceVolume: number };
}
export interface DramaReference { kind: 'character' | 'scene' | 'image'; targetId: string; candidateId: string; name: string }
export interface DramaCandidate {
  renderSource?: import('./drama-version').DramaRenderSource;
  id: string; projectId: string; kind: DramaKind; targetId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  url?: string; text?: string; error?: string; taskId?: string; createdAt?: string;
  source: 'model' | 'upload' | 'render' | 'workflow'; workflowOrigin?: { workflowId: string; runId: string; nodeId: string; workflowVersion: number; definitionHash?: string; sourceRevision: number }; inputFingerprint?: string; stale?: boolean;
  references?: DramaReference[];
  manualReferenceCount?: number;
  archiveStatus?: string; archiveError?: string;
}
export interface DramaProject { stageTemplates?: Array<{ id: string; version: number; stage: string; appliedAt: string; revision: number }>; id: string; revision: number; plan: DramaPlan; updatedAt?: string; candidates: DramaCandidate[]; pendingRequests?: Array<{ id: string; kind: DramaKind; count: number }>; budget?: { limit: number; used: number; reserved: number; remaining: number }; archived?: boolean; history?: Array<{ revision: number; savedAt: string }> }
export interface DramaQuote { id: string; kind: DramaKind; count: number; estimatedCost: number; currency: string; expiresAt: string; modelName: string; provider?: string; warnings: string[]; items?: Array<{ targetId: string; title: string; duration?: number; requestedDuration?: number; references?: DramaReference[]; omittedReferences?: DramaReference[]; manualReferenceCount?: number }> }
export const DRAMA_STEPS = ['写故事', '定角色', '看分镜', '做视频', '出成片'];
export const DRAMA_STYLES = ['绘本漫剧', '清新动漫', '电影质感'];
export function emptyDramaPlan(): DramaPlan {
  return { title: '未命名短剧', story: '', inputMode: 'idea', style: DRAMA_STYLES[0], duration: 60, step: 0,
    storyConfirmed: false, castConfirmed: false, storyboardConfirmed: false, characters: [], scenes: [], shots: [],
    settings: { subtitles: true, subtitleStyle: 'white', musicVolume: 18, resolution: '720p' } };
}
