import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Model } from 'mongoose';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lookup } from 'dns';
import { isIP, BlockList } from 'net';
import * as http from 'http';
import * as https from 'https';
import { ShortDramaCandidate, ShortDramaProject } from './drama.schema';
import { DramaPlan, DramaCandidate } from './drama.types';
import { srtText, validateSelections, validateCaptionSources } from './drama-plan';
import { WorkflowAssetService, WORKFLOW_ASSET_MAX_BYTES } from '../workflow/workflow-asset.service';
import { frameDimensions } from './drama-production';
import { DramaTimingReport, DramaVoiceTiming, voiceOverflows } from './drama-timing';
import { CaptionReport, parseSpeechWindows } from './drama-captions';
import { DramaVisualReport, VisualMeasure } from './drama-visual';
import { renderManifest, renderDifferences } from './drama-version';

const execute = promisify(execFile);
const binary = () => process.env.DRAMA_FFMPEG_PATH || 'ffmpeg';
const probeBinary = () => process.env.DRAMA_FFPROBE_PATH || binary().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
const font = () => [process.env.DRAMA_FONT_FILE, 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'].find((file): file is string => !!file && existsSync(file));
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]] as const) denied.addSubnet(address, prefix, 'ipv6');
export function publicMediaAddress(address: string) { const family = isIP(address); if (family === 6 && /^(?:0*:){1,5}ffff:/i.test(address)) return false; return !!family && !denied.check(address, family === 4 ? 'ipv4' : 'ipv6'); }
/** Resolve and pin public IPs at connection time, including every redirect. No shell or remote FFmpeg URLs. */
export async function downloadDramaMedia(raw: string, redirects = 0, expiresAt = Date.now() + 45000): Promise<Buffer> {
  if (expiresAt <= Date.now()) throw new Error('素材下载超时');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || redirects > 3 || !['', '80', '443'].includes(url.port)) throw new Error('素材链接不符合媒体下载要求');
  if (isIP(url.hostname.replace(/[\[\]]/g, '')) && !publicMediaAddress(url.hostname.replace(/[\[\]]/g, ''))) throw new Error('素材地址不可访问');
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, { timeout: 30000, lookup: ((host: string, options: { all?: boolean }, callback: any) => {
      lookup(host, { all: true }, (error, addresses) => {
        if (error || !addresses.length || addresses.some(a => !publicMediaAddress(a.address))) return callback(new Error('素材地址必须解析为公网地址'));
        if (options?.all) callback(null, [addresses[0]]); else callback(null, addresses[0].address, addresses[0].family);
      });
    }) as any }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) { response.resume(); downloadDramaMedia(new URL(response.headers.location, url).href, redirects + 1, expiresAt).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('素材下载失败，请检查链接是否已过期')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 60 * 1024 * 1024) request.destroy(new Error('单个源素材超过 60 MB')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    });
    const deadline = setTimeout(() => request.destroy(new Error('素材下载超时')), Math.max(1, expiresAt - Date.now()));
    request.once('close', () => clearTimeout(deadline));
    request.on('timeout', () => request.destroy(new Error('素材下载超时'))); request.on('error', reject);
  });
}
interface RenderJob { candidateId: string; projectId: string; ownerId: string; plan: DramaPlan; candidates: DramaCandidate[] }

@Injectable()
@Processor('short-drama-render')
export class ShortDramaRenderService {
  private readonly logger = new Logger(ShortDramaRenderService.name);
  private readonly voiceChecks = new Map<string, Promise<DramaVoiceTiming[]>>();
  private readonly inspections = new Map<string, Promise<DramaVisualReport | CaptionReport>>();
  constructor(
    @InjectModel(ShortDramaProject.name) private readonly projects: Model<ShortDramaProject>,
    @InjectModel(ShortDramaCandidate.name) private readonly candidates: Model<ShortDramaCandidate>,
    @InjectQueue('short-drama-render') private readonly queue: Queue<RenderJob>,
    private readonly assets: WorkflowAssetService,
  ) {}
  async capabilities() {
    try {
      await execute(binary(), ['-version'], { timeout: 5000, windowsHide: true });
      await execute(probeBinary(), ['-version'], { timeout: 5000, windowsHide: true });
      return { mp4: true, subtitles: !!font(), reason: font() ? '' : '未配置中文字体，暂不能烧录字幕；仍可导出无字幕视频和 SRT。' };
    } catch { return { mp4: false, subtitles: false, reason: '成片服务无法运行 FFmpeg 或 FFprobe。请联系管理员检查两个程序路径，已完成的镜头会保留。' }; }
  }
  private async voiceSeconds(url: string): Promise<number> {
    const dir = await fs.mkdtemp(join(tmpdir(), 'model-hub-voice-check-'));
    try {
      const data = await downloadDramaMedia(url, 0, Date.now() + 10000);
      await fs.writeFile(join(dir, 'voice.media'), data);
      const analysis = await execute(binary(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', 'voice.media', '-vn', '-progress', 'pipe:1', '-f', 'null', '-'], { cwd: dir, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
      const times = [...analysis.stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)].map(x => Number(x[1]) / 1000000);
      const seconds = Math.max(...times);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid audio duration');
      return seconds;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  private async inspectVoices(ownerId: string, projectId: string, plan: DramaPlan, candidates: DramaCandidate[]): Promise<DramaVoiceTiming[]> {
    const result: DramaVoiceTiming[] = [];
    const deadline = Date.now() + 55000;
    // Sequential and bounded by the plan's 24-shot limit. Successful measurements
    // are cached against the exact archived URL; failed reads remain retryable.
    for (const shot of plan.shots.filter(s => s.voice)) {
      if (Date.now() > deadline - 20000) { result.push({ shotId: shot.id, voiceId: shot.voice, error: '本次检查用时较长，请重新检查以继续读取剩余旁白' }); continue; }
      const candidate = candidates.find(c => c.id === shot.voice)!;
      const cached = candidate as DramaCandidate & { measuredVoiceSeconds?: number; measuredVoiceUrl?: string };
      try {
        const seconds = cached.measuredVoiceUrl === candidate.url && Number.isFinite(cached.measuredVoiceSeconds) && cached.measuredVoiceSeconds! > 0
          ? cached.measuredVoiceSeconds! : await this.voiceSeconds(candidate.url!);
        if (seconds !== cached.measuredVoiceSeconds || candidate.url !== cached.measuredVoiceUrl) await this.candidates.updateOne({ id: candidate.id, ownerId, projectId, url: candidate.url }, { $set: { measuredVoiceSeconds: seconds, measuredVoiceUrl: candidate.url } });
        result.push({ shotId: shot.id, voiceId: candidate.id, seconds });
      } catch { result.push({ shotId: shot.id, voiceId: candidate.id, error: '旁白无法读取，请重试检查，或重新选用可播放的音频' }); }
    }
    return result;
  }
  async timing(ownerId: string, projectId: string, revision: number): Promise<DramaTimingReport> {
    const project = await this.projects.findOne({ ownerId, id: projectId }).lean();
    if (!project) throw new BadRequestException('作品不存在');
    if (project.revision !== revision) throw new BadRequestException('作品已更新，请保存后重新检查旁白');
    const candidates = await this.candidates.find({ ownerId, projectId }).select('+measuredVoiceUrl').lean();
    try { validateSelections(project.plan, candidates as DramaCandidate[]); } catch (e) { throw new BadRequestException((e as Error).message); }
    const key = `${ownerId}:${projectId}:${revision}`;
    let check = this.voiceChecks.get(key);
    if (!check) {
      if (this.voiceChecks.size >= 4) throw new ServiceUnavailableException('旁白检查繁忙，请稍后重试');
      check = this.inspectVoices(ownerId, projectId, project.plan, candidates as DramaCandidate[]);
      this.voiceChecks.set(key, check);
    }
    try { return { projectId, revision, voices: await check }; }
    finally { if (this.voiceChecks.get(key) === check) this.voiceChecks.delete(key); }
  }
  /** Free, owned-media checks; cache only successful measurements of the exact URL. */
  async inspect(ownerId: string, projectId: string, revision: number, kind: 'visual'|'captions'): Promise<DramaVisualReport | CaptionReport> {
    const project = await this.projects.findOne({ownerId,id:projectId}).lean();
    if (!project) throw new BadRequestException('作品不存在');
    if (project.revision !== revision) throw new BadRequestException('作品已更新，请保存后重新检查');
    const candidates = await this.candidates.find({ownerId,projectId}).select('+measuredVisual +measuredVisualUrl +speechAnalysis +speechAnalysisUrl').lean();
    try { validateSelections(project.plan,candidates as DramaCandidate[]); } catch(e) { throw new BadRequestException((e as Error).message); }
    const key=`${ownerId}:${projectId}:${revision}:${kind}`;
    let pending=this.inspections.get(key);
    if (!pending) {
      if (this.inspections.size>=4) throw new ServiceUnavailableException('素材检查繁忙，请稍后重试');
      pending=this.inspectSelected(projectId,revision,project.plan,candidates,kind,ownerId); this.inspections.set(key,pending);
    }
    try { return await pending; } finally { if(this.inspections.get(key)===pending) this.inspections.delete(key); }
  }
  private async inspectSelected(projectId: string, revision: number, plan: DramaPlan, candidates: any[], kind: 'visual'|'captions', ownerId: string): Promise<DramaVisualReport | CaptionReport> {
    const entries: DramaVisualReport['entries']=[], voices: CaptionReport['voices']=[], deadline=Date.now()+55000;
    let downloaded=0;
    for(const shot of plan.shots) for(const mediaKind of (kind==='visual' ? ['image','video'] : ['voice']) as Array<'image'|'video'|'voice'>) {
      const candidate=candidates.find(c=>c.id===shot[mediaKind]); if(!candidate) continue;
      let dir: string | undefined;
      try {
        const cacheValid=kind==='visual' ? candidate.measuredVisualUrl===candidate.url && candidate.measuredVisual : candidate.speechAnalysisUrl===candidate.url && candidate.speechAnalysis;
        let measure: any=cacheValid;
        if(!measure) {
          if(Date.now()>deadline-16000) throw new Error('继续检查');
          dir=await fs.mkdtemp(join(tmpdir(),'model-hub-media-check-'));
          const data=await downloadDramaMedia(candidate.url,0,Date.now()+10000); downloaded+=data.length;
          if(downloaded>300*1024*1024) throw new Error('素材总量过大');
          await fs.writeFile(join(dir,'source.media'),data);
          if(kind==='visual') {
            const probe=await execute(probeBinary(),['-v','error','-show_streams','-show_format','-of','json','-protocol_whitelist','file,pipe','source.media'],{cwd:dir,timeout:10000,windowsHide:true,maxBuffer:1024*1024});
            const info=JSON.parse(probe.stdout), stream=info.streams?.find((s:any)=>s.codec_type==='video');
            if(!stream?.width || !stream?.height) throw new Error('素材不是画面');
            const rotation=Number(stream.side_data_list?.find((s:any)=>s.rotation!==undefined)?.rotation || stream.tags?.rotate || 0);
            const rotated=Math.abs(rotation)%180===90;
            measure={width:rotated ? stream.height : stream.width,height:rotated ? stream.width : stream.height};
            const seconds=Number(stream.duration || info.format?.duration); if(Number.isFinite(seconds) && seconds>0) measure.seconds=seconds;
          } else {
            const analysis=await execute(binary(),['-hide_banner','-loglevel','info','-nostdin','-protocol_whitelist','file,pipe','-i','source.media','-vn','-af','silencedetect=noise=-35dB:d=0.15','-progress','pipe:1','-f','null','-'],{cwd:dir,timeout:10000,windowsHide:true,maxBuffer:1024*1024});
            const seconds=Math.max(...[...analysis.stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)].map(x=>Number(x[1])/1000000));
            if(!Number.isFinite(seconds) || seconds<=0) throw new Error('音频无法解码');
            measure={seconds,windows:parseSpeechWindows(analysis.stderr,seconds)};
          }
          await this.candidates.updateOne({ownerId,projectId,id:candidate.id,url:candidate.url},{$set:kind==='visual' ? {measuredVisual:measure,measuredVisualUrl:candidate.url} : {speechAnalysis:measure,speechAnalysisUrl:candidate.url,measuredVoiceSeconds:measure.seconds,measuredVoiceUrl:candidate.url}});
        }
        if(kind==='visual') entries.push({shotId:shot.id,candidateId:candidate.id,kind:mediaKind as 'image'|'video',...measure as VisualMeasure});
        else voices.push({shotId:shot.id,voiceId:candidate.id,...measure});
      } catch {
        if(kind==='visual') entries.push({shotId:shot.id,candidateId:candidate.id,kind:mediaKind as 'image'|'video',error:'尺寸暂时无法读取，请重试检查或替换可播放素材'});
        else voices.push({shotId:shot.id,voiceId:candidate.id,error:'旁白停顿暂时无法读取，请重试，或按文字分句后手动校正'});
      } finally { if(dir) await fs.rm(dir,{recursive:true,force:true}); }
    }
    return kind==='visual' ? {projectId,revision,entries} : {projectId,revision,voices};
  }
  @OnQueueFailed()
  async failed(job: Job<RenderJob>) {
    await this.candidates.updateOne({ id: job.data.candidateId, status: { $in: ['pending', 'running'] } }, { $set: { status: 'failed', completedAt: new Date(), error: '成片任务中断。原始镜头保留，请重新导出或联系管理员检查渲染服务。' } });
  }
  async start(ownerId: string, id: string, revision: number, requestId: string) {
    const project = await this.projects.findOne({ ownerId, id }).lean();
    if (!project) throw new BadRequestException('作品不存在');
    const existing = await this.candidates.findOne({ id: requestId, ownerId, projectId: id, kind: 'export' }).lean();
    if (existing && existing.status !== 'pending') return { id: existing.id };
    if (process.env.DRAMA_EXPORT_ENABLED === 'false') throw new ServiceUnavailableException('新合成暂时暂停，已有成片仍可播放和下载');
    const collision = await this.candidates.findOne({ id: requestId, $or: [{ ownerId: { $ne: ownerId } }, { projectId: { $ne: id } }, { kind: { $ne: 'export' } }] }).lean();
    if (collision) throw new BadRequestException('导出请求 ID 不可复用');
    if (project.revision !== revision) throw new BadRequestException('作品已更新，请保存并重新检查导出设置');
    if (existing?.renderSource && renderDifferences(project.plan, existing.renderSource)?.length) throw new BadRequestException('原导出请求的内容已有修改，请重新确认并创建新的导出请求');
    const capabilities = await this.capabilities();
    if (!capabilities.mp4 || (project.plan.settings.subtitles && !capabilities.subtitles)) throw new ServiceUnavailableException(capabilities.reason);
    const candidates = await this.candidates.find({ ownerId, projectId: id }).lean();
    try { validateSelections(project.plan, candidates as DramaCandidate[]); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (!project.plan.storyboardConfirmed || !project.plan.shots.length || project.plan.shots.some(s => !s.video)) throw new BadRequestException('先完成分镜确认，并为每个镜头选用视频');
    try { validateCaptionSources(project.plan); } catch(e) { throw new BadRequestException((e as Error).message); }
    const timing = await this.timing(ownerId, id, revision);
    const invalid = timing.voices.find(v => v.error || voiceOverflows(project.plan.shots.find(s => s.id === v.shotId)!.duration, v.seconds));
    if (invalid) throw new BadRequestException(`镜头 ${project.plan.shots.findIndex(s => s.id === invalid.shotId) + 1}：${invalid.error || `旁白约 ${invalid.seconds!.toFixed(1)} 秒，超过镜头时长。请在出成片步骤调整时长或缩短旁白`}`);
    const current = await this.projects.findOne({ ownerId, id }).lean();
    if (current?.revision !== revision) throw new BadRequestException('检查期间作品已更新，请保存后重新导出');
    // The client supplies a stable UUID per confirmation so retrying a timed-out request cannot duplicate renders.
    await this.candidates.updateOne({ id: requestId }, { $setOnInsert: { id: requestId, ownerId, projectId: id, kind: 'export', targetId: 'project', source: 'render', status: 'pending', renderSource: { revision, manifest: renderManifest(project.plan) } } }, { upsert: true });
    await this.queue.add({ candidateId: requestId, ownerId, projectId: id, plan: project.plan, candidates: candidates.map(c => ({ id: c.id, kind: c.kind, targetId: c.targetId, url: c.url, status: c.status })) as DramaCandidate[] },
      { jobId: requestId, attempts: 1, removeOnComplete: true, removeOnFail: 50, timeout: 15 * 60 * 1000 });
    return { id: requestId };
  }
  @Process({ concurrency: 1 })
  async render(job: Job<RenderJob>) {
    const { candidateId, projectId, ownerId, plan, candidates } = job.data;
    const dir = await fs.mkdtemp(join(tmpdir(), 'model-hub-drama-'));
    const deadline = Date.now() + 12 * 60 * 1000;
    const remaining = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error('成片合成超时，请缩短片长后重试'); return ms; };
    const ffmpeg = (args: string[]) => execute(binary(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd: dir, timeout: Math.min(180000, remaining()), maxBuffer: 1024 * 1024, windowsHide: true });
    try {
      await this.candidates.updateOne({ id: candidateId }, { $set: { status: 'running' } });
      const media = new Map(candidates.map(c => [c.id, c.url])); let downloaded = 0;
      const store = async (url: string, name: string) => { remaining(); const buffer = await downloadDramaMedia(url); remaining(); downloaded += buffer.length; if (downloaded > 300 * 1024 * 1024) throw new Error('本次源素材总大小超过 300 MB'); await fs.writeFile(join(dir, name), buffer); };
      const size = frameDimensions(plan).join(':');
      const fit = plan.frame?.fit === 'cover' ? `scale=${size}:force_original_aspect_ratio=increase,crop=${size}` : `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`;
      for (let i = 0; i < plan.shots.length; i++) {
        const shot = plan.shots[i], url = media.get(shot.video!); if (!url) throw new Error('镜头缺少已选视频');
        await store(url, `source-${i}.media`);
        const probe = await execute(probeBinary(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', '-protocol_whitelist', 'file,pipe', `source-${i}.media`], { cwd: dir, timeout: Math.min(10000, remaining()), windowsHide: true });
        const info = JSON.parse(probe.stdout), video = info.streams?.find((s: any) => s.codec_type === 'video');
        const sourceDuration = Number(video?.duration || info.format?.duration);
        if (!video || !Number.isFinite(sourceDuration) || sourceDuration <= (shot.trimStart || 0)) throw new Error(`镜头 ${i + 1} 的裁剪起点超出视频，或素材无法读取。请调整起点或替换视频。`);
        const voice = media.get(shot.voice || ''); if (voice) await store(voice, `voice-${i}.media`);
        if (voice) {
          const analysis = await ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', `voice-${i}.media`, '-vn', '-progress', 'pipe:1', '-f', 'null', '-']);
          const times = [...analysis.stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)].map(x => Number(x[1]) / 1000000);
          if (!times.length) throw new Error(`无法确认镜头 ${i + 1} 的旁白时长，请检查配音素材`);
          const seconds = Math.max(...times);
          if (seconds > shot.duration + 0.3) throw new Error(`镜头 ${i + 1} 的旁白约 ${seconds.toFixed(1)} 秒，超过镜头的 ${shot.duration} 秒。请延长镜头或缩短旁白后重新导出。`);
        }
        await ffmpeg([...(shot.trimStart ? ['-ss', String(shot.trimStart)] : []), '-protocol_whitelist', 'file,pipe', '-i', `source-${i}.media`, ...(voice ? ['-protocol_whitelist', 'file,pipe', '-i', `voice-${i}.media`] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']),
          '-filter_complex', `[0:v]${fit},setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${shot.duration}[v];[1:a]${voice && plan.settings.normalizeVoice ? 'loudnorm=I=-16:TP=-1.5:LRA=11,' : ''}volume=${(plan.frame?.voiceVolume ?? 100) / 100},apad[a]`,
          '-map', '[v]', '-map', '[a]', '-t', String(shot.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', `shot-${i}.mp4`]);
        await job.progress(Math.round((i + 1) / (plan.shots.length + 2) * 100));
      }
      await fs.writeFile(join(dir, 'sequence.txt'), plan.shots.map((_, i) => `file 'shot-${i}.mp4'`).join('\n'));
      await ffmpeg(['-f', 'concat', '-safe', '1', '-i', 'sequence.txt', '-c', 'copy', 'joined.mp4']);
      const filters: string[] = [], args = ['-i', 'joined.mp4'];
      if (plan.settings.subtitles) {
        await fs.copyFile(font()!, join(dir, 'drama-font.ttc'));
        await fs.writeFile(join(dir, 'captions.srt'), srtText(plan), 'utf8');
        filters.push(`subtitles=captions.srt:fontsdir=.:force_style='FontSize=18,MarginV=60,PrimaryColour=${plan.settings.subtitleStyle === 'warm' ? '&H00B0E4FF' : '&H00FFFFFF'},Outline=1.5'`);
      }
      const music = media.get(plan.settings.music || '');
      if (music) { await store(music, 'music.media'); args.push('-stream_loop', '-1', '-protocol_whitelist', 'file,pipe', '-i', 'music.media'); }
      args.push(...(filters.length ? ['-vf', filters.join(',')] : []));
      if (music) args.push('-filter_complex', plan.settings.musicDucking
        ? `[0:a]asplit=2[voice][side];[1:a]volume=${plan.settings.musicVolume / 100}[music];[music][side]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[ducked];[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0[audio]`
        : `[1:a]volume=${plan.settings.musicVolume / 100}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[audio]`, '-map', '0:v', '-map', '[audio]');
      args.push('-t', String(plan.shots.reduce((sum, s) => sum + s.duration, 0)), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', 'final.mp4');
      await ffmpeg(args);
      const output = await fs.readFile(join(dir, 'final.mp4'));
      if (output.length > WORKFLOW_ASSET_MAX_BYTES) throw new Error('成片超过当前素材存储的 20 MB 限制，请降低清晰度或缩短片长后重试');
      const asset = await this.assets.upload(ownerId, { buffer: output, mimetype: 'video/mp4', originalname: `${plan.title}.mp4` }, 'drama-render');
      await this.candidates.updateOne({ id: candidateId, projectId }, { $set: { status: 'succeeded', completedAt: new Date(), url: asset.url, text: srtText(plan) } });
      await job.progress(100);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Render failed: project=${projectId}, candidate=${candidateId}`, message.slice(0, 6000));
      await this.candidates.updateOne({ id: candidateId, projectId }, { $set: { status: 'failed', completedAt: new Date(), error: /ffmpeg|Command failed|ENOENT|timed out/i.test(message) ? '成片合成失败，请检查视频编码、中文字体与 FFmpeg 服务。原镜头已保留，可调整设置后重试。' : message.slice(0, 300) } });
    } finally {
      // mkdtemp returns the exact directory owned by this job; never clean a caller-provided path.
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
