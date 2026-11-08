/** Opt-in local acceptance: real HTTP/Mongo/Redis/FFmpeg; identity, model provider,
 * media transport and object storage are isolated test adapters. Never bills a user. */
import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import Bull = require('bull');
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { ShortDramaController } from './drama.controller';
import { ShortDramaService } from './drama.service';
import { ShortDramaRenderService } from './drama-render.service';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema, ShortDramaQuote, ShortDramaQuoteSchema } from './drama.schema';
import { ModelConfig, ModelConfigSchema } from '../database/schemas/model-config.schema';
import { WorkflowAsset, WorkflowAssetSchema } from '../database/schemas/workflow-asset.schema';
import { emptyDramaPlan, DramaProject, DramaKind } from './drama.types';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ApiClientService } from '../api-client/api-client.service';
import { PortalApiKeyService } from '../portal-auth/portal-api-key.service';
import { PortalAuthService } from '../portal-auth/portal-auth.service';
import { APP_CONFIG } from '../config/config.module';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from '../common/interceptors/response-transform.interceptor';
import { estimateCaptions } from './drama-captions';

const execute = promisify(execFile);
const acceptance = process.env.DRAMA_ACCEPTANCE === '1' ? describe : describe.skip;
acceptance('Short drama five-stage local acceptance (no paid providers)', () => {
  let mongo: MongoMemoryServer, db: Connection, app: INestApplication, queue: Bull.Queue;
  let projects: Model<ShortDramaProject>, candidates: Model<ShortDramaCandidate>, assets: Model<WorkflowAsset>;
  let service: ShortDramaService, render: ShortDramaRenderService, origin: string, work: string;
  let getSpy: jest.SpyInstance, httpsSpy: jest.SpyInstance;
  const media = new Map<string, Buffer>(), uploads = new Map<string, Buffer>();
  const ffmpeg = process.env.DRAMA_FFMPEG_PATH || 'ffmpeg';
  const probe = process.env.DRAMA_FFPROBE_PATH || join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const reportDir = resolve(process.env.DRAMA_TEST_REPORT_DIR || 'output/short-drama');
  const tasks = { createTask: jest.fn(), getTask: jest.fn(), cancelTask: jest.fn() };
  const keys = { findExecutionBillingKey: jest.fn().mockResolvedValue('isolated-test-key'), validate: jest.fn() };
  const identity = { verifyAccessToken: (token: string) => {
    if (!['acceptance-owner', 'acceptance-other'].includes(token)) throw new UnauthorizedException();
    return { sub: token };
  }, getUserById: async (id: string) => ({ id, status: 'active', role: 'user' }) };
  async function api(path: string, method = 'GET', body?: unknown, owner = 'acceptance-owner') {
    const response = await fetch(origin + '/v1/short-dramas' + path, { method,
      headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${owner}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result: any = await response.json(); return { status: response.status, ...result };
  }
  async function save(p: DramaProject, patch: Partial<DramaProject['plan']>) {
    const r = await api('/' + p.id, 'PUT', { revision: p.revision, plan: { ...p.plan, ...patch } });
    expect(r.status).toBe(200); return r.data as DramaProject;
  }
  async function attach(p: DramaProject, kind: DramaKind, targetId: string, url: string, mimeType: string) {
    const asset = await assets.create({ id: randomUUID(), ownerId: 'acceptance-owner', name: 'isolated acceptance media',
      kind: kind === 'video' ? 'video' : ['voice', 'music'].includes(kind) ? 'audio' : 'image', url, mimeType, source: 'upload' });
    const r = await api(`/${p.id}/assets`, 'POST', { kind, targetId, assetId: asset.id }); expect(r.status).toBe(201); return r.data.id as string;
  }
  async function finishExport(p: DramaProject, requestId = randomUUID()) {
    const r = await api(`/${p.id}/exports`, 'POST', { revision: p.revision, requestId }); expect(r.status).toBe(201);
    const job = await queue.getJob(requestId); expect(job).toBeTruthy(); await job!.finished();
    return (await api('/' + p.id)).data.candidates.find((c: any) => c.id === requestId);
  }
  beforeAll(async () => {
    work = await fs.mkdtemp(join(tmpdir(), 'drama-acceptance-')); await fs.mkdir(reportDir, { recursive: true });
    for (const [name, source, format] of [
      ['teal.mp4', 'color=c=0x145C63:s=320x240:r=24:d=2', 'video'],
      ['violet.mp4', 'color=c=0x514073:s=240x320:r=24:d=2', 'video'],
      ['voice.wav', 'sine=frequency=440:duration=1', 'audio'],
      ['long-voice.wav', 'sine=frequency=440:duration=5', 'audio'],
      ['music.wav', 'sine=frequency=220:duration=2', 'audio'],
    ]) {
      await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source,
        ...(format === 'video' ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] : []), join(work, name)], { windowsHide: true });
      media.set('https://acceptance.invalid/' + name, await fs.readFile(join(work, name)));
    }
    media.set('https://acceptance.invalid/broken.mp4', Buffer.from('intentionally invalid video'));
    await execute(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=teal:s=320x240','-frames:v','1',join(work,'frame.png')],{windowsHide:true});
    media.set('https://acceptance.invalid/frame.png',await fs.readFile(join(work,'frame.png')));
    // Only fixture transport is substituted. All decoder/filter/encoder commands below are real.
    const fixtureGet = ((url: URL, _options: unknown, callback: any) => {
      const request: any = new EventEmitter(); request.destroy = (e: Error) => { request.emit('error', e); request.emit('close'); };
      process.nextTick(() => { const buffer = media.get(url.href) || uploads.get(url.href); const response: any = new PassThrough(); response.statusCode = buffer ? 200 : 404;
        response.headers = {}; callback(response); response.end(buffer); response.once('end', () => request.emit('close')); });
      return request;
    }) as any;
    mongo = await MongoMemoryServer.create(); db = await createConnection(mongo.getUri()).asPromise();
    projects = db.model(ShortDramaProject.name, ShortDramaProjectSchema); candidates = db.model(ShortDramaCandidate.name, ShortDramaCandidateSchema);
    const quotes = db.model(ShortDramaQuote.name, ShortDramaQuoteSchema), configs = db.model(ModelConfig.name, ModelConfigSchema);
    assets = db.model(WorkflowAsset.name, WorkflowAssetSchema); await Promise.all([projects.init(), candidates.init(), quotes.init(), assets.init()]);
    for (const type of ['textGenerate', 'textToImage', 'textToVideo', 'tts', 'music']) await configs.create({
      model_id: 'acceptance-' + type, model_type: type, model_name: 'Isolated acceptance ' + type, provider: 'test', revision: 1,
      unit_price_map: { default: { unit_credit: 1 } }, params: { prompt: { type: 'string', required: true } },
    });
    getSpy = jest.spyOn(require('http'), 'get').mockImplementation(fixtureGet);
    httpsSpy = jest.spyOn(require('https'), 'get').mockImplementation(fixtureGet);
    queue = new Bull('render', { prefix: 'drama-acceptance-' + randomUUID(), redis: { host: '127.0.0.1', port: Number(process.env.DRAMA_TEST_REDIS_PORT || 6379), maxRetriesPerRequest: 1 } });
    service = new ShortDramaService(projects as any, candidates as any, quotes as any, configs as any, assets as any, keys as any, tasks as any, { assertNodesAllowed: async () => {} } as any);
    render = new ShortDramaRenderService(projects as any, candidates as any, queue as any, { upload: async (ownerId: string, file: any) => {
      const id = randomUUID(), url = 'https://acceptance.invalid/export-' + id + '.mp4'; uploads.set(url, file.buffer);
      return assets.create({ id, ownerId, name: file.originalname, kind: 'video', mimeType: file.mimetype, url, source: 'upload', size: file.buffer.length });
    } } as any);
    // Keep completed jobs until assertions inspect them; uses an isolated UUID Redis prefix only.
    const add = queue.add.bind(queue); jest.spyOn(queue, 'add').mockImplementation(((data: any, options: any) => add(data, { ...options, removeOnComplete: false })) as any);
    queue.process(1, job => render.render(job));
    const module = await Test.createTestingModule({ controllers: [ShortDramaController], providers: [
      { provide: ShortDramaService, useValue: service }, { provide: ShortDramaRenderService, useValue: render },
      { provide: APP_CONFIG, useValue: {} }, { provide: ApiClientService, useValue: { validatePresentedKey: async () => null } },
      { provide: PortalApiKeyService, useValue: keys }, { provide: PortalAuthService, useValue: identity },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  }, 120000);
  afterAll(async () => {
    await app?.close(); if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    getSpy?.mockRestore(); httpsSpy?.mockRestore(); await db?.close(); await mongo?.stop(); if (work) await fs.rm(work, { recursive: true, force: true });
  });
  let finishedProject: DramaProject;
  it('creates, confirms, quotes, selects and renders a six-second film through real HTTP and Redis', async () => {
    expect((await api('', 'GET', undefined, '')).status).toBe(401);
    const created = await api('', 'POST', { plan: { ...emptyDramaPlan(), title: '隔离流程验收片', story: '女孩走进咖啡馆，发现一封来自明天的信。',
      characters: [{ id: 'girl', name: '女孩', description: '短发、米色风衣' }], scenes: [{ id: 'cafe', name: '咖啡馆', description: '雨后的咖啡馆' }],
      shots: [1, 2].map(i => ({ id: 'shot' + i, title: '测试镜头 ' + i, description: '女孩推开咖啡馆的门', narration: i === 1 ? '这是第一段中文字幕。' : '第二段故事结束。', duration: 3, characterIds: ['girl'], sceneId: 'cafe' })) } });
    expect(created.status).toBe(201); let p: DramaProject = created.data;
    expect((await api('/' + p.id, 'GET', undefined, 'acceptance-other')).status).toBe(404);
    expect((await api(`/${p.id}/quotes`, 'POST', { kind: 'character', targetIds: ['girl'] })).status).toBe(400);
    p = await save(p, { storyConfirmed: true, step: 1 }); p = await save(p, { castConfirmed: true, step: 2 });
    for (const shot of p.plan.shots) {
      const image = await attach(p, 'image', shot.id, 'https://acceptance.invalid/frame.png', 'image/png');
      p = await save(p, { shots: p.plan.shots.map(s => s.id === shot.id ? { ...s, image } : s) });
    }
    p = await save(p, { storyboardConfirmed: true, step: 3 });
    tasks.createTask.mockImplementation(async (_key, input) => ({ taskId: input.metadata.dramaCandidateId }));
    tasks.getTask.mockResolvedValue({ status: 'SUCCESS', result: { output: ['https://acceptance.invalid/teal.mp4'] } });
    const quoted = await api(`/${p.id}/quotes`, 'POST', { kind: 'video', targetIds: ['shot1', 'shot2'] });
    if (quoted.status !== 201) throw new Error('Quote preflight: ' + JSON.stringify(quoted));
    // Existing video pricing uses its default five-second tier when no duration parameter exists.
    expect(quoted.data.estimatedCost).toBe(10); expect(tasks.createTask).not.toHaveBeenCalled();
    expect((await api(`/${p.id}/generate`, 'POST', { quoteId: quoted.data.id })).status).toBe(201);
    await api(`/${p.id}/generate`, 'POST', { quoteId: quoted.data.id }); expect(tasks.createTask).toHaveBeenCalledTimes(2);
    p = (await api('/' + p.id)).data;
    const voice = await attach(p, 'voice', 'shot1', 'https://acceptance.invalid/voice.wav', 'audio/wav');
    const music = await attach(p, 'music', 'project', 'https://acceptance.invalid/music.wav', 'audio/wav');
    const secondVideo = await attach(p, 'video', 'shot2', 'https://acceptance.invalid/violet.mp4', 'video/mp4');
    p = await save(p, { step: 4, shots: p.plan.shots.map((s, i) => ({ ...s, video: i ? secondVideo : p.candidates.find(c => c.targetId === s.id && c.kind === 'video')!.id, ...(i ? {} : { voice }) })), settings: { ...p.plan.settings, music, normalizeVoice: true, musicDucking: true } });
    expect((await api('/' + p.id)).data.plan).toEqual(p.plan);
    const checked=await api(`/${p.id}/media-check`,'POST',{revision:p.revision});expect(checked.status).toBe(201);
    expect(checked.data.entries).toHaveLength(4);expect(checked.data.entries.find((e:any)=>e.kind==='video')).toMatchObject({width:320,height:240});
    expect((await api(`/${p.id}/media-check`,'POST',{revision:p.revision},'acceptance-other')).status).toBe(400);
    expect((await api(`/${p.id}/caption-timing`,'POST',{revision:p.revision-1})).status).toBe(400);
    const speech=await api(`/${p.id}/caption-timing`,'POST',{revision:p.revision});expect(speech.status).toBe(201);expect(speech.data.voices[0].seconds).toBeCloseTo(1,1);
    const first=p.plan.shots[0],cues=estimateCaptions(first,speech.data.voices[0]);expect(cues[0].end).toBeLessThan(1.1);
    p=await save(p,{shots:p.plan.shots.map((s,i)=>i?s:{...s,captions:[{start:0,end:.45,text:'这是第一段'},{start:.5,end:1,text:'中文字幕。'}],captionSource:{narration:s.narration,voiceId:s.voice,method:'pause'}})});
    expect((await api('/capabilities')).data).toMatchObject({ mp4: true, subtitles: true });
    const requestId = randomUUID(), exported = await finishExport(p, requestId);
    if (exported.status !== 'succeeded') throw new Error('Render: ' + JSON.stringify(exported));
    expect(exported).toMatchObject({ status: 'succeeded', source: 'render' });
    const mediaPath = `${origin}/v1/short-dramas/${p.id}/candidates/${exported.id}/media`;
    const ownedMedia = await fetch(mediaPath, { headers: { Authorization: 'Bearer acceptance-owner' } });
    expect(ownedMedia.status).toBe(200); expect(ownedMedia.headers.get('content-type')).toContain('video/mp4');
    expect(Buffer.from(await ownedMedia.arrayBuffer())).toEqual(uploads.get(exported.url));
    expect((await fetch(mediaPath, { headers: { Authorization: 'Bearer acceptance-other' } })).status).toBe(404);
    expect(exported.text).toContain('00:00:03,000 --> 00:00:06,000'); expect(exported.text).toContain('中文字幕');
    expect(exported.text).toContain('00:00:00,500 --> 00:00:01,000');
    expect((await api(`/${p.id}/exports`, 'POST', { revision: p.revision, requestId })).data.id).toBe(requestId); expect(uploads.size).toBe(1);
    const file = join(reportDir, 'synthetic-acceptance-720p.mp4'); await fs.writeFile(file, uploads.get(exported.url)!);
    await fs.writeFile(join(reportDir, 'synthetic-acceptance.srt'), exported.text, 'utf8');
    const { stdout } = await execute(probe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true });
    const metadata = JSON.parse(stdout); expect(metadata.streams.find((s: any) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 720, height: 1280 });
    expect(metadata.streams.find((s: any) => s.codec_type === 'audio')).toMatchObject({ codec_name: 'aac', channels: 2 });
    expect(Math.abs(Number(metadata.format.duration) - 6)).toBeLessThan(0.15);
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', join(reportDir, 'synthetic-subtitles.png')], { windowsHide: true });
    await fs.writeFile(join(reportDir, 'media-probe.json'), JSON.stringify(metadata, null, 2)); finishedProject = p;
  }, 120000);
  it('exports 1080p without subtitles or music, and only renders a new version', async () => {
    const p = await save(finishedProject, { settings: { ...finishedProject.plan.settings, resolution: '1080p', subtitles: false, music: undefined } });
    const before = tasks.createTask.mock.calls.length, result = await finishExport(p); expect(result.status).toBe('succeeded'); expect(tasks.createTask).toHaveBeenCalledTimes(before);
    const file = join(reportDir, 'synthetic-acceptance-1080p.mp4'); await fs.writeFile(file, uploads.get(result.url)!);
    const { stdout } = await execute(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]);
    expect(JSON.parse(stdout).streams[0]).toMatchObject({ width: 1080, height: 1920 }); finishedProject = p;
  }, 120000);
  it('rejects overlong narration and malformed video without publishing partial exports', async () => {
    const long = await attach(finishedProject, 'voice', 'shot1', 'https://acceptance.invalid/long-voice.wav', 'audio/wav');
    let p = await save(finishedProject, { shots: finishedProject.plan.shots.map((s, i) => i ? s : { ...s, voice: long }) });
    const before = uploads.size, timing = await api(`/${p.id}/voice-timing`, 'POST', { revision: p.revision });
    expect(timing.status).toBe(201); expect(timing.data.voices[0].seconds).toBeCloseTo(5, 1);
    expect((await api(`/${p.id}/voice-timing`, 'POST', { revision: p.revision }, 'acceptance-other')).status).toBe(400);
    const failed = await api(`/${p.id}/exports`, 'POST', { revision: p.revision, requestId: randomUUID() });
    expect(failed.status).toBe(400); expect(failed.message).toMatch(/镜头 1.*旁白.*超过/); expect(uploads.size).toBe(before);
    const broken = await attach(p, 'video', 'shot1', 'https://acceptance.invalid/broken.mp4', 'video/mp4');
    p = await save(p, { shots: p.plan.shots.map((s, i) => i ? s : { ...s, video: broken, voice: undefined }) });
    const invalid = await finishExport(p); expect(invalid.status).toBe('failed'); expect(uploads.size).toBe(before);
  }, 120000);
  it('renders landscape crop with fractional subtitles and rejects a trim beyond the source', async () => {
    finishedProject = (await api('/' + finishedProject.id)).data;
    let p = await save(finishedProject, { frame: { ratio: '16:9', fit: 'cover', voiceVolume: 80 }, storyboardConfirmed: true,
      shots: finishedProject.plan.shots.map((s, i) => ({ ...s, video: finishedProject.candidates.find(c => c.kind === 'video' && c.targetId === s.id && c.status === 'succeeded')!.id, voice: undefined, captions:undefined,captionSource:undefined,trimStart: 0.25, subtitleStart: 0.5, subtitleEnd: 2.75 })),
      settings: { ...finishedProject.plan.settings, subtitles: true, resolution: '720p', music: undefined } });
    // A changed ratio invalidates approval. Reconfirm the same reviewed storyboard explicitly.
    p = await save(p, { storyboardConfirmed: true });
    const before = tasks.createTask.mock.calls.length;
    const result = await finishExport(p); expect(result.status).toBe('succeeded');
    expect(result.text).toContain('00:00:00,500 --> 00:00:02,750');
    const file = join(reportDir, 'synthetic-landscape-crop.mp4'); await fs.writeFile(file, uploads.get(result.url)!);
    const metadata = await execute(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]);
    expect(JSON.parse(metadata.stdout).streams[0]).toMatchObject({ width: 1280, height: 720 });
    p = await save(p, { shots: p.plan.shots.map((s, i) => i ? s : { ...s, trimStart: 180 }) });
    const invalid = await finishExport(p); expect(invalid.status).toBe('failed'); expect(invalid.error).toContain('裁剪起点超出');
    expect(tasks.createTask).toHaveBeenCalledTimes(before);
  }, 120000);
});
