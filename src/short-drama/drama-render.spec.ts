import { ShortDramaRenderService } from './drama-render.service';
import { emptyDramaPlan } from './drama.types';
import { randomUUID } from 'crypto';
import { renderManifest } from './drama-version';

describe('Short drama export preflight', () => {
  function setup() {
    const plan = { ...emptyDramaPlan(), story: '故事', storyConfirmed: true, castConfirmed: true, storyboardConfirmed: true, characters: [{ id: 'girl', name: '女孩', description: '短发' }],
      shots: [{ id: 'shot1', title: '相遇', description: '推门', narration: '你好', duration: 5, characterIds: ['girl'], image: 'image1', video: 'video1' }] };
    const projects = { findOne: jest.fn().mockReturnValue({ lean: async () => ({ id: 'project', ownerId: 'owner', revision: 2, plan }) }) };
    const candidates = { findOne: jest.fn().mockReturnValue({ lean: async () => null }), find: jest.fn().mockReturnValue({ lean: async () => [{ id: 'image1', kind: 'image', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/i.jpg' }, { id: 'video1', kind: 'video', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/v.mp4' }] }), updateOne: jest.fn() };
    candidates.find.mockReturnValue({ select() { return this; }, lean: async () => [{ id: 'image1', kind: 'image', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/i.jpg' }, { id: 'video1', kind: 'video', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/v.mp4' }] } as any);
    const queue = { add: jest.fn() }, service = new ShortDramaRenderService(projects as any, candidates as any, queue as any, {} as any);
    jest.spyOn(service, 'capabilities').mockResolvedValue({ mp4: true, subtitles: true, reason: '' });
    return { service, projects, candidates, queue, plan };
  }
  it('blocks unavailable encoders or fonts before queueing an export', async () => {
    const h = setup(); jest.mocked(h.service.capabilities).mockResolvedValue({ mp4: false, subtitles: false, reason: '缺少 FFmpeg' });
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('缺少 FFmpeg'); expect(h.queue.add).not.toHaveBeenCalled();
    jest.mocked(h.service.capabilities).mockResolvedValue({ mp4: true, subtitles: false, reason: '缺少中文字体' });
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('缺少中文字体'); expect(h.queue.add).not.toHaveBeenCalled();
  });
  it('keeps inspection ownership and revision checks, and reuses exact-URL visual and speech measurements',async()=>{
    const h=setup(),originals=await h.candidates.find().lean();
    (h.plan.shots[0] as any).voice='voice';
    const measured=[...originals.map((c:any)=>({...c,measuredVisualUrl:c.url,measuredVisual:{width:640,height:360,seconds:5}})),{id:'voice',kind:'voice',targetId:'shot1',status:'succeeded',url:'https://media.example/a.mp3',speechAnalysisUrl:'https://media.example/a.mp3',speechAnalysis:{seconds:2,windows:[{start:.1,end:1.9}]}}];
    h.candidates.find.mockReturnValue({select(){return this;},lean:async()=>measured} as any);
    const result:any=await h.service.inspect('owner','project',2,'visual');expect(result.entries).toHaveLength(2);expect(result.entries[0]).toMatchObject({width:640,height:360});
    const captions:any=await h.service.inspect('owner','project',2,'captions');expect(captions.voices[0]).toMatchObject({voiceId:'voice',seconds:2});
    expect(h.projects.findOne).toHaveBeenCalledWith({ownerId:'owner',id:'project'});expect(h.candidates.updateOne).not.toHaveBeenCalled();
    await expect(h.service.inspect('owner','project',1,'visual')).rejects.toThrow('作品已更新');
    h.projects.findOne.mockReturnValue({lean:async()=>null} as any);await expect(h.service.inspect('other','project',2,'visual')).rejects.toThrow('作品不存在');
  });
  it('rejects stale caption alignment before exporting, while retaining no-subtitle exports',async()=>{
    const h=setup();Object.assign(h.plan.shots[0],{captions:[{start:0,end:2,text:'旧旁白'}],captionSource:{narration:'旧旁白',method:'pause'}});
    await expect(h.service.start('owner','project',2,randomUUID())).rejects.toThrow('重新生成分句字幕');expect(h.queue.add).not.toHaveBeenCalled();
    h.plan.settings.subtitles=false;await h.service.start('owner','project',2,randomUUID());expect(h.queue.add).toHaveBeenCalledTimes(1);
  });
  it('invalidates URL-bound visual caches and never probes a private media URL',async()=>{
    const h=setup(),originals=await h.candidates.find().lean();
    h.candidates.find.mockReturnValue({select(){return this;},lean:async()=>originals.map((c:any)=>({...c,url:'http://127.0.0.1/private.media',measuredVisualUrl:c.url,measuredVisual:{width:999,height:999}}))} as any);
    const result:any=await h.service.inspect('owner','project',2,'visual');
    expect(result.entries).toHaveLength(2);expect(result.entries.every((e:any)=>e.error && !e.width)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');expect(h.candidates.updateOne).not.toHaveBeenCalled();
  });
  it('queues a frozen plan using the explicit request id and rejects stale revisions', async () => {
    const h = setup(), requestId = randomUUID(); await expect(h.service.start('owner', 'project', 1, requestId)).rejects.toThrow('作品已更新');
    await h.service.start('owner', 'project', 2, requestId);
    expect(h.candidates.updateOne).toHaveBeenCalledWith({id:requestId},expect.objectContaining({$setOnInsert:expect.objectContaining({renderSource:{revision:2,manifest:renderManifest(h.plan)}})}),{upsert:true});
    expect(h.queue.add).toHaveBeenCalledWith(expect.objectContaining({ candidateId: requestId, ownerId: 'owner', plan: h.plan }), expect.objectContaining({ jobId: requestId, attempts: 1 }));
    h.candidates.findOne.mockReturnValue({ lean: async () => ({ id: requestId, status: 'running' } as any) });
    await h.service.start('owner', 'project', 2, requestId); expect(h.queue.add).toHaveBeenCalledTimes(1);
  });
  it('re-enqueues a pending render after a failed queue submission', async () => {
    const h = setup(), requestId = randomUUID(); h.queue.add.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(h.service.start('owner', 'project', 2, requestId)).rejects.toThrow('redis unavailable');
    h.candidates.findOne.mockReturnValueOnce({ lean: async () => ({ id: requestId, status: 'pending' } as any) });
    await h.service.start('owner', 'project', 2, requestId); expect(h.queue.add).toHaveBeenCalledTimes(2);
  });
  it('does not replace a pending request snapshot when the draft changed before retry',async()=>{
    const h=setup(),requestId=randomUUID(),manifest=renderManifest(h.plan);
    h.plan.shots[0].video='different';
    h.candidates.findOne.mockReturnValueOnce({lean:async()=>({id:requestId,status:'pending',renderSource:{revision:2,manifest}})} as any);
    await expect(h.service.start('owner','project',2,requestId)).rejects.toThrow('原导出请求');
    expect(h.queue.add).not.toHaveBeenCalled();expect(h.candidates.updateOne).not.toHaveBeenCalled();
  });
  it('checks ownership and revisions before reading any media', async () => {
    const h = setup(), probe = jest.spyOn(h.service as any, 'voiceSeconds');
    await expect(h.service.timing('owner', 'project', 1)).rejects.toThrow('作品已更新');
    h.projects.findOne.mockReturnValue({ lean: async () => null } as any);
    await expect(h.service.timing('other', 'project', 2)).rejects.toThrow('作品不存在');
    expect(probe).not.toHaveBeenCalled();
  });
  it('blocks oversized speech before queueing and reuses only a matching URL measurement', async () => {
    const h = setup(); (h.plan.shots[0] as any).voice = 'voice';
    const voice = { id: 'voice', kind: 'voice', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/voice.mp3', measuredVoiceUrl: 'https://media.example/old.mp3', measuredVoiceSeconds: 2 };
    const originals = await h.candidates.find().lean();
    h.candidates.find.mockReturnValue({ select() { return this; }, lean: async () => [...originals, voice] } as any);
    const probe = jest.spyOn(h.service as any, 'voiceSeconds').mockResolvedValue(6.2);
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('旁白约 6.2 秒');
    expect(h.queue.add).not.toHaveBeenCalled(); expect(h.candidates.updateOne).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner', url: voice.url }), expect.objectContaining({ $set: { measuredVoiceSeconds: 6.2, measuredVoiceUrl: voice.url } }));
    voice.measuredVoiceUrl = voice.url;
    const result = await h.service.timing('owner', 'project', 2);
    expect(result.voices[0].seconds).toBe(2); expect(probe).toHaveBeenCalledTimes(1);
  });
  it('lets failed reads be retried and detects edits made during a check', async () => {
    const h = setup(); (h.plan.shots[0] as any).voice = 'voice';
    const originals = await h.candidates.find().lean();
    h.candidates.find.mockReturnValue({ select() { return this; }, lean: async () => [...originals, { id: 'voice', kind: 'voice', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/voice.mp3' }] } as any);
    const probe = jest.spyOn(h.service as any, 'voiceSeconds').mockRejectedValueOnce(new Error('private upstream URL')).mockResolvedValue(3);
    expect((await h.service.timing('owner', 'project', 2)).voices[0].error).toContain('旁白无法读取');
    expect(h.candidates.updateOne).not.toHaveBeenCalled();
    expect((await h.service.timing('owner', 'project', 2)).voices[0].seconds).toBe(3);
    jest.spyOn(h.service, 'timing').mockImplementation(async () => {
      h.projects.findOne.mockReturnValue({ lean: async () => ({ revision: 3 }) } as any);
      return { projectId: 'project', revision: 2, voices: [] };
    });
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('检查期间作品已更新');
    expect(h.queue.add).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledTimes(2);
  });
});
