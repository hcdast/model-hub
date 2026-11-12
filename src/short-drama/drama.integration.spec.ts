import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, createConnection } from 'mongoose';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema, ShortDramaQuote, ShortDramaQuoteSchema } from './drama.schema';
import { ModelConfig, ModelConfigSchema } from '../database/schemas/model-config.schema';
import { WorkflowAsset, WorkflowAssetSchema } from '../database/schemas/workflow-asset.schema';
import { ShortDramaService } from './drama.service';
import { emptyDramaPlan } from './drama.types';
import { ForbiddenException } from '@nestjs/common';
import { InsufficientBalanceException } from '../billing/exceptions/insufficient-balance.exception';
import { renderManifest } from './drama-version';

describe('Short drama persistence and authorized generation', () => {
  let mongo: MongoMemoryServer, db: Connection, service: ShortDramaService;
  let projects: Model<ShortDramaProject>, candidates: Model<ShortDramaCandidate>, quotes: Model<ShortDramaQuote>;
  let configs: Model<ModelConfig>, assets: Model<WorkflowAsset>;
  const keys = { ensureExecutionBillingKey: jest.fn() }, tasks = { createTask: jest.fn(), getTask: jest.fn(), cancelTask: jest.fn() }, policy = { assertNodesAllowed: jest.fn() };
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); db = await createConnection(mongo.getUri()).asPromise();
    projects = db.model(ShortDramaProject.name, ShortDramaProjectSchema); candidates = db.model(ShortDramaCandidate.name, ShortDramaCandidateSchema); quotes = db.model(ShortDramaQuote.name, ShortDramaQuoteSchema);
    configs = db.model(ModelConfig.name, ModelConfigSchema); assets = db.model(WorkflowAsset.name, WorkflowAssetSchema);
    await Promise.all([projects.init(), candidates.init(), quotes.init()]);
    service = new ShortDramaService(projects as any, candidates as any, quotes as any, configs as any, assets as any, keys as any, tasks as any, policy as any);
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    await Promise.all([projects.deleteMany({}), candidates.deleteMany({}), quotes.deleteMany({}), configs.deleteMany({}), assets.deleteMany({})]); jest.clearAllMocks();
    keys.ensureExecutionBillingKey.mockResolvedValue('private-billing-key'); tasks.createTask.mockResolvedValue({ taskId: 'task-real' }); tasks.getTask.mockResolvedValue({ status: 'PROCESSING' });
    await configs.create({ model_id: 'image-model', model_type: 'textToImage', model_name: '测试模型', provider: 'test', revision: 1,
      unit_price_map: { default: { unit_credit: 2 } }, params: { prompt: { type: 'string', required: true }, batch_quantity: { type: 'integer', required: false, default: 1 } } });
  });
  async function project() { return service.create('owner', { ...emptyDramaPlan(), story: '女孩在咖啡馆相遇', storyConfirmed: true, characters: [{ id: 'girl', name: '小雨', description: '短发风衣' }] }); }
  it('persists export source snapshots and exposes only the current owner’s versions',async()=>{
    const p=await project(),renderSource={revision:p.revision,manifest:renderManifest(p.plan)};
    await candidates.create({id:'export-snapshot',ownerId:'owner',projectId:p.id,kind:'export',targetId:'project',source:'render',status:'succeeded',url:'https://media.example/film.mp4',renderSource});
    await candidates.create({id:'foreign-snapshot',ownerId:'other',projectId:p.id,kind:'export',targetId:'project',source:'render',status:'succeeded',url:'https://media.example/private.mp4',renderSource});
    const result=await service.view(await service.find('owner',p.id));
    expect(result.candidates).toHaveLength(1);expect(result.candidates[0].renderSource).toEqual(renderSource);
    await expect(service.find('other',p.id)).rejects.toThrow('无权');
  });
  it('quotes actual reference capacity and freezes the same owned reference inputs on submission',async()=>{
    let p=await service.create('owner',{...emptyDramaPlan(),story:'咖啡馆来信',storyConfirmed:true,characters:[{id:'girl',name:'小雨',description:'风衣'},{id:'boy',name:'小林',description:'夹克'}],scenes:[{id:'cafe',name:'咖啡馆',description:'木窗'}],shots:[{id:'s',title:'推门',description:'二人推门',narration:'你好',duration:5,characterIds:['girl','boy'],sceneId:'cafe'}]});
    await candidates.create([{id:'girl-ref',kind:'character',targetId:'girl'},{id:'boy-ref',kind:'character',targetId:'boy'},{id:'cafe-ref',kind:'scene',targetId:'cafe'}].map(c=>({...c,ownerId:'owner',projectId:p.id,source:'upload',status:'succeeded',url:`https://media.example/${c.id}`})));
    p=await service.update('owner',p.id,p.revision,{...p.plan,characters:p.plan.characters.map(r=>({...r,selected:r.id+'-ref'})),scenes:p.plan.scenes.map(r=>({...r,selected:r.id+'-ref'}))});
    p=await service.update('owner',p.id,p.revision,{...p.plan,castConfirmed:true});
    const scalar=await configs.create({model_id:'scalar-ref',model_name:'单图测试',model_type:'imageToImage',provider:'test',unit_price_map:{default:{unit_credit:1}},params:{prompt:{type:'string'},image:{type:'string',required:true}}});
    const multi=await configs.create({model_id:'multi-ref',model_name:'多图测试',model_type:'imageToImage',provider:'test',unit_price_map:{default:{unit_credit:1}},params:{prompt:{type:'string'},image:{type:'string'},images:{type:'array',items:{type:'string'},maxItems:2,required:true}}});
    const single=await service.quote('owner',p.id,'image',['s'],String(scalar._id),{image:'https://unexpected.example/image'});
    expect(single.items[0].references!.map(r=>r.name)).toEqual(['小雨']);expect(single.items[0].omittedReferences!.map(r=>r.name)).toEqual(['小林','咖啡馆']);
    const q=await service.quote('owner',p.id,'image',['s'],String(multi._id));
    expect(q.items[0].references!.map(r=>r.name)).toEqual(['小雨','小林']);expect(q.items[0].omittedReferences!.map(r=>r.name)).toEqual(['咖啡馆']);
    expect(tasks.createTask).not.toHaveBeenCalled();
    const recommended=await service.quote('owner',p.id,'image',['s']);
    expect(recommended.modelName).toBe('多图测试');expect(recommended.items[0].references).toHaveLength(2);
    await service.confirm('owner',p.id,q.id);
    expect(tasks.createTask.mock.calls[0][1].input.images).toEqual(['https://media.example/girl-ref','https://media.example/boy-ref']);
    const result=await service.get('owner',p.id),made=result.candidates.find(c=>c.kind==='image');
    if (!made?.references) throw new Error('generated candidate must retain references');
    expect(made.references.map(r=>r.candidateId)).toEqual(['girl-ref','boy-ref']);
    await service.update('owner',p.id,result.revision,{...result.plan,characters:result.plan.characters.map(r=>({...r,selected:undefined}))});
    const reopened=await service.get('owner',p.id);expect(reopened.candidates.find(c=>c.id===made.id)).toMatchObject({stale:true,references:made.references});
  });
  it('explicitly reports no reference inputs when the selected image model only accepts text',async()=>{
    let p=await project();await candidates.create({id:'girl-ref',ownerId:'owner',projectId:p.id,kind:'character',targetId:'girl',source:'upload',status:'succeeded',url:'https://media.example/girl.png'});
    p=await service.update('owner',p.id,p.revision,{...p.plan,characters:[{...p.plan.characters[0],selected:'girl-ref'}],shots:[{id:'s',title:'推门',description:'女孩推门',narration:'',duration:5,characterIds:['girl']}]});
    p=await service.update('owner',p.id,p.revision,{...p.plan,castConfirmed:true});
    const q=await service.quote('owner',p.id,'image',['s']);
    expect(q.items[0]).toMatchObject({references:[],omittedReferences:[{candidateId:'girl-ref'}]});expect(tasks.createTask).not.toHaveBeenCalled();
    p=await service.update('owner',p.id,p.revision,{...p.plan,characters:[{...p.plan.characters[0],selected:undefined}]});
    p=await service.update('owner',p.id,p.revision,{...p.plan,castConfirmed:true});
    const manual=await configs.create({model_id:'manual-image',model_name:'手动图像输入',model_type:'imageToImage',provider:'test',unit_price_map:{default:{unit_credit:1}},params:{prompt:{type:'string'},image:{type:'string',required:true}}});
    const manualQuote=await service.quote('owner',p.id,'image',['s'],String(manual._id),{image:'https://media.example/manual.png'});
    expect(manualQuote.items[0]).toMatchObject({references:[],manualReferenceCount:1});
  });
  it('quotes and submits the visible per-shot compatible duration, including its actual price',async()=>{
    const cfg=await configs.create({model_id:'compatible-video',model_type:'imageToVideo',provider:'test',model_name:'十秒模型',revision:1,unit_price_map:{default:{unit_credit:1}},params:{prompt:{type:'string',required:true},image:{type:'string',required:true},duration:{type:'integer',enum:[5,10],default:5}}});
    const p=await service.create('owner',{...emptyDramaPlan(),story:'来信',storyConfirmed:true,castConfirmed:true,characters:[{id:'girl',name:'女孩',description:'短发'}],shots:[{id:'s',title:'收到来信',description:'推门',narration:'你好',duration:8,characterIds:['girl']}]});
    await candidates.create({id:'source-image',ownerId:'owner',projectId:p.id,kind:'image',targetId:'s',source:'upload',status:'succeeded',url:'https://media.example/frame.png'});
    const framed=await service.update('owner',p.id,0,{...p.plan,shots:[{...p.plan.shots[0],image:'source-image'}]});
    await service.update('owner',p.id,framed.revision,{...framed.plan,storyboardConfirmed:true});
    const q=await service.quote('owner',p.id,'video',['s'],String(cfg._id));
    expect(q).toMatchObject({estimatedCost:10,items:[{title:'收到来信',duration:10,requestedDuration:8}]});
    expect(q.warnings.join(' ')).toContain('跟随参考图');
    expect(tasks.createTask).not.toHaveBeenCalled();
    await service.confirm('owner',p.id,q.id);expect(tasks.createTask.mock.calls[0][1].input).toMatchObject({image:'https://media.example/frame.png',duration:10});
  });
  it('persists drafts, isolates owners and detects competing edits without losing the winner', async () => {
    const p = await project(); await expect(service.get('other', p.id)).rejects.toThrow('作品不存在');
    const saved = await service.update('owner', p.id, p.revision, { ...p.plan, title: '云端新版本' }); expect(saved.revision).toBe(1);
    await expect(service.update('owner', p.id, p.revision, { ...p.plan, title: '过期副本' })).rejects.toThrow('作品已在其他窗口更新');
    expect((await service.get('owner', p.id)).plan.title).toBe('云端新版本');
  });
  it('retains cast approval across BSON null optional fields and ordinary saves', async () => {
    const p = await project();
    const approved = await service.update('owner', p.id, p.revision, { ...p.plan, castConfirmed: true });
    expect(approved.plan.castConfirmed).toBe(true);
    // Legacy Mixed plans may contain BSON nulls for absent optional references.
    await projects.updateOne({ id: p.id }, { $set: { 'plan.characters.0.selected': null } });
    const reopened = await service.get('owner', p.id);
    const saved = await service.update('owner', p.id, reopened.revision, { ...reopened.plan, step: 2 });
    expect(saved.plan.castConfirmed).toBe(true);
    expect(saved.plan.characters[0]).not.toHaveProperty('selected');
    const changed = await service.update('owner', p.id, saved.revision, { ...saved.plan,
      characters: [{ ...saved.plan.characters[0], description: '长发' }] });
    expect(changed.plan.castConfirmed).toBe(false);
  });
  it('quotes without provisioning billing or starting tasks; rejects expired and changed quotes', async () => {
    const p = await project(); keys.ensureExecutionBillingKey.mockResolvedValue(null);
    const q = await service.quote('owner', p.id, 'character', ['girl']);
    expect(q.estimatedCost).toBe(2); expect(tasks.createTask).not.toHaveBeenCalled();
    expect(keys.ensureExecutionBillingKey).not.toHaveBeenCalled();
    await service.update('owner', p.id, 0, { ...p.plan, title: '新标题' }); await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('报价已过期或作品已修改');
    const q2 = await service.quote('owner', p.id, 'character', ['girl']); await quotes.updateOne({ id: q2.id }, { $set: { expiresAt: new Date(0) } }); await expect(service.confirm('owner', p.id, q2.id)).rejects.toThrow('报价已过期');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('checks a shared OpenAPI voice once per batch and fails closed without caching failures across quotes', async () => {
    const cfg = await configs.create({ model_id: 'batch-tts', model_type: 'tts', provider: 'akool-openapi', model_name: '批量配音', revision: 1,
      unit_price_map: { default: { unit_credit: 0.01 } }, pricing: { usage_type: 'count', usage_param: 'text', usage_measure: 'characters' }, params: { text: { type: 'string', required: true }, voice_id: { type: 'string', required: true }, voice_model_name: { type: 'string', default: 'Akool Multilingual 3', hide: true } } });
    const voice = { validateVoice: jest.fn().mockRejectedValue(new Error('音色服务暂时不可用')) };
    const mixed = new ShortDramaService(projects as any, candidates as any, quotes as any, configs as any, assets as any, keys as any, tasks as any, policy as any, undefined, voice as any);
    const p = await mixed.create('owner', { ...emptyDramaPlan(), story: '一封信', storyConfirmed: true, castConfirmed: true,
      characters: [{ id: 'girl', name: '小雨', description: '风衣' }], shots: Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: '', description: '拿起信', narration: '你好', duration: 5, characterIds: ['girl'] })),
      production: { provider: 'akool-openapi', models: { voice: String(cfg._id) }, voiceParameters: { voice_id: 'official-reference' } } });
    await expect(mixed.quote('owner', p.id, 'voice', p.plan.shots.map(s => s.id))).rejects.toThrow('音色服务暂时不可用');
    expect(voice.validateVoice).toHaveBeenCalledTimes(1); expect(await quotes.countDocuments()).toBe(0); expect(tasks.createTask).not.toHaveBeenCalled();
    voice.validateVoice.mockResolvedValue({});
    expect(await mixed.quote('owner', p.id, 'voice', p.plan.shots.map(s => s.id))).toMatchObject({ count: 6, estimatedCost: 0.12 });
    expect(voice.validateVoice).toHaveBeenCalledTimes(2); expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('reuses persisted voice settings, takes narration from the shot and validates against the chosen model', async () => {
    const cfg=await configs.create({model_id:'isolated-tts',model_type:'tts',provider:'akool-maas',model_name:'测试配音',revision:1,unit_price_map:{default:{unit_credit:0.001}},params:{text:{type:'string',required:true},voice:{type:'string',enum:['warm','clear'],required:true},speed:{type:'number',min:0.5,max:2,default:1}}});
    const p=await service.create('owner',{...emptyDramaPlan(),story:'小雨收到信',storyConfirmed:true,castConfirmed:true,characters:[{id:'girl',name:'小雨',description:'短发'}],shots:[{id:'s',title:'信',description:'拿起信',narration:'你好，明天见。',duration:5,characterIds:['girl']}],production:{provider:'akool-maas',models:{voice:String(cfg._id)},voiceParameters:{voice:'warm',speed:1.1,text:'ignored'}}});
    const quote=await service.quote('owner',p.id,'voice',['s']);
    expect(quote.estimatedCost).toBe(1); // Fixture: 1000 estimated tokens × 0.001 credit.
    expect(tasks.createTask).not.toHaveBeenCalled();
    await service.confirm('owner',p.id,quote.id);
    expect(tasks.createTask.mock.calls[0][1].input).toMatchObject({text:'你好，明天见。',voice:'warm',speed:1.1});
    await service.update('owner',p.id,0,{...p.plan,production:{...p.plan.production,voiceParameters:{voice:'missing'}}});
    await expect(service.quote('owner',p.id,'voice',['s'])).rejects.toThrow('检查未通过');
  });
  it('reports the explicitly selected provider and submits that configuration', async () => {
    const cfg = await configs.create({ model_id: 'wavespeed-image', model_type: 'textToImage', model_name: '同名模型', provider: 'wavespeed-ai', revision: 1,
      unit_price_map: { default: { unit_credit: 1 } }, params: { prompt: { type: 'string', required: true } } });
    const catalog = await service.catalog();
    expect(catalog.find(m => m.configId === String(cfg._id))).toMatchObject({ provider: 'wavespeed-ai' });
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl'], String(cfg._id));
    expect(q).toMatchObject({ provider: 'wavespeed-ai', estimatedCost: 1 });
    expect(tasks.createTask).not.toHaveBeenCalled();
    await service.confirm('owner', p.id, q.id);
    expect(tasks.createTask.mock.calls[0][1]).toMatchObject({ model: 'wavespeed-image', options: { configId: String(cfg._id) } });
  });
  it('persists mixed MaaS/OpenAPI production and validates a voice before quoting without changing the media provider', async () => {
    const cfg = await configs.create({ model_id: 'voice-openapi', model_type: 'tts', provider: 'akool-openapi', model_name: '官方配音', revision: 1,
      unit_price_map: { default: { unit_credit: 0.01 } }, pricing: { usage_type: 'count', usage_param: 'text', usage_measure: 'characters' },
      params: { text: { type: 'string', required: true }, voice_id: { type: 'string', required: true }, voice_model_name: { type: 'string', required: true, default: 'Akool Multilingual 3', enum: ['Akool Multilingual 3'], hide: true } } });
    const voice = { validateVoice: jest.fn().mockResolvedValue({}), voices: jest.fn().mockResolvedValue({ items: [{ name: '官方音色' }], page: 1, hasMore: false }) };
    const mixed = new ShortDramaService(projects as any, candidates as any, quotes as any, configs as any, assets as any, keys as any, tasks as any, policy as any, undefined, voice as any);
    const p = await mixed.create('owner', { ...emptyDramaPlan(), story: '小雨收到信', storyConfirmed: true, castConfirmed: true,
      characters: [{ id: 'girl', name: '小雨', description: '短发' }], shots: [{ id: 's', title: '信', description: '拿起信', narration: '你😀好！', duration: 5, characterIds: ['girl'] }],
      production: { provider: 'akool-maas', providers: { voice: 'akool-openapi' }, models: { voice: String(cfg._id) }, voiceParameters: { voice_id: 'fixture-reference' } } });
    const q = await mixed.quote('owner', p.id, 'voice', ['s']);
    expect(q).toMatchObject({ provider: 'akool-openapi', estimatedCost: 0.04 });
    expect(voice.validateVoice).toHaveBeenCalledWith({ text: '你😀好！', voice_id: 'fixture-reference', voice_model_name: 'Akool Multilingual 3' });
    expect(tasks.createTask).not.toHaveBeenCalled();
    expect((await mixed.get('owner', p.id)).plan.production).toMatchObject({ provider: 'akool-maas', providers: { voice: 'akool-openapi' } });
    expect(await mixed.voices('owner', String(cfg._id))).toMatchObject({ items: [{ name: '官方音色' }] });
    await mixed.confirm('owner', p.id, q.id);
    expect(tasks.createTask.mock.calls[0][1]).toMatchObject({ model: 'voice-openapi', options: { configId: String(cfg._id), featureType: 'tts' } });
    voice.validateVoice.mockRejectedValue(new Error('音色已失效'));
    await expect(mixed.quote('owner', p.id, 'voice', ['s'])).rejects.toThrow('音色已失效');
    voice.validateVoice.mockRejectedValue(new Error('音色服务暂时不可用，尚未提交配音生成，请稍后重试'));
    await expect(mixed.quote('owner', p.id, 'voice', ['s'])).rejects.toThrow('本次未提交配音生成，请按提示重试');
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
    await expect(mixed.voices('owner', 'invalid')).rejects.toThrow('ID 不正确');
  });
  it('runs an explicitly configured LLM script through quote, candidate extraction and settled project spend', async () => {
    const contract = require('../common/fixtures/maas-llm.contract.json');
    const cfg = await configs.create({ ...contract, model_id: 'local-llm-fixture', disabled: false, revision: 1, unit_price_map: { default: { unit_credit: 0.001 } } });
    const p = await service.create('owner', { ...emptyDramaPlan(), story: '雨后收到信', production: { provider: 'akool-maas', models: { script: String(cfg._id) } } });
    const q = await service.quote('owner', p.id, 'script', ['project'], undefined, { maas_protocol: 'wrong', prompt: 'untrusted replacement' });
    expect(q.estimatedCost).toBe(4.096);
    expect(tasks.createTask).not.toHaveBeenCalled();
    await service.confirm('owner', p.id, q.id);
    expect(tasks.createTask.mock.calls[0][1].input).toMatchObject({ maas_protocol: 'chat-completions', max_tokens: 4096, prompt: expect.stringContaining('雨后收到信') });
    expect(tasks.createTask.mock.calls[0][3]).toEqual({ maxCharge: 4.096 });
    const text = JSON.stringify({ title: '信', characters: [], scenes: [], shots: [{ description: '雨停了', duration: 5 }] });
    tasks.getTask.mockResolvedValue({ status: 'SUCCESS', result: { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }, billing: { status: 'settled', actualCost: 0.15 } });
    const completed = await service.get('owner', p.id);
    expect(completed.candidates[0]).toMatchObject({ kind: 'script', status: 'succeeded', text });
    expect(completed.budget).toEqual({ limit: 100, used: 0.15, reserved: 0, remaining: 99.85 });
    expect(completed.plan.shots).toHaveLength(0); // Requires the user's review and adoption.
  });
  it('atomically admits one of two batches against a shared project budget and resumes without reserving twice', async () => {
    const p = await project(); await service.setBudget('owner', p.id, 0, 2);
    const a = await service.quote('owner', p.id, 'character', ['girl']);
    const b = await service.quote('owner', p.id, 'character', ['girl']);
    const result = await Promise.allSettled([service.confirm('owner', p.id, a.id), service.confirm('owner', p.id, b.id)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
    expect(tasks.createTask.mock.calls[0][3]).toEqual({ maxCharge: 2 });
    const held = await service.get('owner', p.id);
    expect(held.budget).toEqual({ limit: 2, used: 0, reserved: 2, remaining: 0 });
    const winner = result[0].status === 'fulfilled' ? a : b;
    await service.confirm('owner', p.id, winner.id);
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
    await expect(service.setBudget('owner', p.id, 1, 1)).rejects.toThrow('预算');
    tasks.getTask.mockResolvedValue({ status: 'FAILED', billing: { status: 'refunded', actualCost: 0 } });
    const refunded = await service.get('owner', p.id);
    expect(refunded.budget).toEqual({ limit: 2, used: 0, reserved: 0, remaining: 2 });
  });
  it('persists a chosen provider, refuses a silent fallback and retains readable work when generation is paused', async () => {
    const p = await project();
    await service.update('owner', p.id, 0, { ...p.plan, production: { provider: 'akool-maas', models: {} } });
    await expect(service.quote('owner', p.id, 'character', ['girl'])).rejects.toThrow('没有可用');
    const previous = process.env.DRAMA_GENERATION_ENABLED;
    try {
      process.env.DRAMA_GENERATION_ENABLED = 'false';
      await expect(service.quote('owner', p.id, 'character', ['girl'])).rejects.toThrow('暂停');
      expect((await service.get('owner', p.id)).plan.story).toBe(p.plan.story);
    } finally { if (previous === undefined) delete process.env.DRAMA_GENERATION_ENABLED; else process.env.DRAMA_GENERATION_ENABLED = previous; }
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('restores saved plans, copies drafts without sharing selected results and archives recoverably', async () => {
    const p = await project();
    const changed = await service.update('owner', p.id, 0, { ...p.plan, title: '新版' });
    const restored = await service.restore('owner', p.id, changed.revision, 0);
    expect(restored.plan.title).toBe(p.plan.title);
    const copy = await service.copy('owner', p.id); expect(copy.id).not.toBe(p.id); expect(copy.plan.storyConfirmed).toBe(false);
    await service.archive('owner', p.id, restored.revision, true);
    expect((await service.list('owner')).items.some(x => x.id === p.id)).toBe(false);
    expect((await service.list('owner', 1, true)).items.some(x => x.id === p.id)).toBe(true);
    await expect(service.restore('other', p.id, 0, 0)).rejects.toThrow('不存在');
  });
  it('builds mixed-provider template defaults without submitting tasks or silently resolving ambiguity', async () => {
    const voice = await configs.create({ model_id: 'template-tts', model_name: '模板配音', model_type: 'tts', provider: 'akool-openapi', disabled: false, params: {}, unit_price_map: { default: { unit_credit: 0.01 } } });
    const script = await configs.create({ model_id: 'template-llm', model_name: '模板编剧', model_type: 'textGenerate', provider: 'akool-maas', disabled: false, params: {}, unit_price_map: { default: { unit_credit: 0.01 } } });
    const disabled = await configs.create({ model_id: 'disabled-tts', model_name: '禁用配音', model_type: 'tts', provider: 'akool-openapi', disabled: true, params: {} });
    const templates = await service.templates();
    expect(templates[0].missing).not.toContain('tts');
    const p = await service.fromTemplate('owner', templates[0].id);
    expect(p.plan.production).toMatchObject({ provider: 'akool-maas', models: { script: String(script._id), voice: String(voice._id) }, providers: { script: 'akool-maas', voice: 'akool-openapi' } });
    expect(p.candidates).toEqual([]);
    expect(tasks.createTask).not.toHaveBeenCalled();
    await configs.updateOne({ _id: disabled._id }, { $set: { disabled: false } });
    const ambiguous = await service.fromTemplate('owner', templates[0].id);
    expect(ambiguous.plan.production?.models.voice).toBeUndefined();
    expect(ambiguous.plan.production?.models.script).toBe(String(script._id));
    // Existing projects keep their snapshot after a configuration is disabled.
    await configs.updateOne({ _id: voice._id }, { $set: { disabled: true } });
    expect((await service.get('owner', p.id)).plan.production?.models.voice).toBe(String(voice._id));
  });
  it('creates independent template snapshots and refuses an unknown template version', async () => {
    const templates = await service.templates(); expect(templates[0].generatedMedia).toBe(false);
    const a = await service.fromTemplate('owner', templates[0].id), b = await service.fromTemplate('owner', templates[0].id);
    expect(a.id).not.toBe(b.id); expect(a.plan.production?.provider).toBe('akool-maas');
    expect(a.candidates).toHaveLength(0); expect(a.plan.storyConfirmed).toBe(false);
    await service.update('owner', a.id, 0, { ...a.plan, title: '我的版本' });
    expect((await service.get('owner', b.id)).plan.title).not.toBe('我的版本');
    await expect(service.fromTemplate('owner', 'missing-v2')).rejects.toThrow('模板');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('checks ownership before fetching media and rejects text candidates as video', async () => {
    const p = await project();
    await candidates.create({ id: 'script-output', ownerId: 'owner', projectId: p.id, kind: 'script', targetId: 'project', source: 'model', status: 'succeeded', url: 'https://private.invalid/data' });
    await expect(service.media('other', p.id, 'script-output')).rejects.toThrow('作品不存在');
    await expect(service.media('owner', p.id, 'script-output')).rejects.toThrow('尚未就绪');
  });
  it('archives each result once and retains its source when archiving fails', async () => {
    const p = await project();
    const storage = { upload: jest.fn().mockImplementation((ownerId, file, source) => assets.create({ id: 'owned-asset', ownerId, name: file.originalname, kind: 'video', mimeType: file.mimetype, url: 'https://owned.invalid/archived.mp4', source })) };
    const archiver = new ShortDramaService(projects as any, candidates as any, quotes as any, configs as any, assets as any, keys as any, tasks as any, policy as any, storage as any);
    const download = jest.spyOn(require('./drama-render.service'), 'downloadDramaMedia').mockResolvedValue(Buffer.from('0000ftypisom'));
    try {
      await candidates.create({ id: 'source-video', ownerId: 'owner', projectId: p.id, kind: 'video', targetId: 's', source: 'model', status: 'succeeded', url: 'https://provider.invalid/source.mp4' });
      await Promise.all([(archiver as any).archiveResults('owner', p.id), (archiver as any).archiveResults('owner', p.id)]);
      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(await candidates.findOne({ id: 'source-video' }).lean()).toMatchObject({ url: 'https://owned.invalid/archived.mp4', assetId: 'owned-asset', archiveStatus: 'archived' });
      storage.upload.mockRejectedValueOnce(new Error('storage temporarily unavailable'));
      await candidates.create({ id: 'retry-video', ownerId: 'owner', projectId: p.id, kind: 'video', targetId: 's', source: 'model', status: 'succeeded', url: 'https://provider.invalid/retry.mp4' });
      await (archiver as any).archiveResults('owner', p.id);
      expect(await candidates.findOne({ id: 'retry-video' }).lean()).toMatchObject({ url: 'https://provider.invalid/retry.mp4', archiveStatus: 'failed' });
      await (archiver as any).archiveResults('owner', p.id);
      expect(storage.upload).toHaveBeenCalledTimes(2);
    } finally { download.mockRestore(); }
  });
  it('claims each confirmation once, resumes the same request idempotently and persists genuine outputs', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    const running = await service.confirm('owner', p.id, q.id); expect(running.candidates[0].status).toBe('running');
    await service.confirm('owner', p.id, q.id); expect(tasks.createTask).toHaveBeenCalledTimes(1);
    expect(tasks.createTask.mock.calls[0][2]).toMatch(/^drama:/);
    expect(JSON.stringify(running)).not.toContain('private-billing-key'); expect(JSON.stringify(running)).not.toContain('outputSchema');
    tasks.getTask.mockResolvedValue({ status: 'SUCCESS', result: { output: ['https://media.example/girl.jpg'] } });
    const ready = await service.get('owner', p.id); expect(ready.candidates[0]).toMatchObject({ status: 'succeeded', url: 'https://media.example/girl.jpg' });
    const saved = await service.update('owner', p.id, 0, { ...p.plan, characters: [{ ...p.plan.characters[0], selected: ready.candidates[0].id }] });
    expect(saved.plan.characters[0].selected).toBe(ready.candidates[0].id);
  });
  it('blocks tampered selections and model price changes, and preserves old candidates on retakes', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    await configs.updateOne({}, { $set: { 'unit_price_map.default.unit_credit': 3 } }); await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('模型配置或价格已更新');
    await expect(service.update('owner', p.id, 0, { ...p.plan, characters: [{ ...p.plan.characters[0], selected: 'forged' }] })).rejects.toThrow('选用素材');
    const q2 = await service.quote('owner', p.id, 'character', ['girl']); await service.confirm('owner', p.id, q2.id);
    tasks.getTask.mockResolvedValue({ status: 'SUCCESS', result: ['https://media.example/original.jpg'] }); await service.get('owner', p.id);
    const q3 = await service.quote('owner', p.id, 'character', ['girl']); await service.confirm('owner', p.id, q3.id);
    expect(await candidates.countDocuments({ projectId: p.id })).toBe(2);
  });
  it('recovers paid video outputs after a parser fix without resubmitting or reviving cancelled tasks', async () => {
    const p = await project();
    await candidates.create({ id: 'paid-video', ownerId: 'owner', projectId: p.id, kind: 'video', targetId: 'shot1', source: 'model',
      status: 'failed', taskId: 'paid-task', billingKey: 'private-billing-key', error: '任务成功，但返回格式中没有可使用的结果。请检查模型输出配置。' });
    await candidates.create({ id: 'cancelled-video', ownerId: 'owner', projectId: p.id, kind: 'video', targetId: 'shot1', source: 'model',
      status: 'failed', taskId: 'cancelled-task', billingKey: 'private-billing-key', error: '已取消，可重新制作' });
    tasks.getTask.mockResolvedValue({ status: 'SUCCESS', result: { videos: ['https://media.example/paid.mp4'] } });
    const recovered = await service.get('owner', p.id);
    expect(recovered.candidates.find(c => c.id === 'paid-video')).toMatchObject({ status: 'succeeded', url: 'https://media.example/paid.mp4' });
    expect(recovered.candidates.find(c => c.id === 'paid-video')?.error).toBeUndefined();
    expect(recovered.candidates.find(c => c.id === 'cancelled-video')?.status).toBe('failed');
    await service.get('owner', p.id);
    expect(tasks.getTask).toHaveBeenCalledTimes(1);
    expect(tasks.getTask).toHaveBeenCalledWith('private-billing-key', 'paid-task');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('recovers a lost submission response with the same request key after reopening', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    tasks.createTask.mockRejectedValueOnce(new Error('connection interrupted'));
    await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('connection interrupted');
    const reopened = await service.get('owner', p.id); expect(reopened.pendingRequests).toEqual([{ id: q.id, kind: 'character', count: 1 }]);
    const firstKey = tasks.createTask.mock.calls[0][2]; await service.confirm('owner', p.id, q.id);
    expect(tasks.createTask.mock.calls[1][2]).toBe(firstKey); expect(await candidates.countDocuments({ projectId: p.id })).toBe(1);
    expect((await service.get('owner', p.id)).pendingRequests).toEqual([]);
  });
  it('keeps the original candidate billing scope when resuming a pre-upgrade submission', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    tasks.createTask.mockRejectedValueOnce(new Error('connection interrupted'));
    await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('connection interrupted');
    keys.ensureExecutionBillingKey.mockResolvedValue('portal:new-account-wallet');
    await service.confirm('owner', p.id, q.id);
    expect(tasks.createTask.mock.calls[0][0]).toBe('private-billing-key');
    expect(tasks.createTask.mock.calls[1][0]).toBe('private-billing-key');
    expect(tasks.createTask.mock.calls[1][2]).toBe(tasks.createTask.mock.calls[0][2]);
  });
  it('rejects an inactive billing account on confirmation without submitting or reserving project budget', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    keys.ensureExecutionBillingKey.mockRejectedValueOnce(new ForbiddenException('账号不可用'));
    await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('账号不可用');
    expect(tasks.createTask).not.toHaveBeenCalled();
    expect((await service.get('owner', p.id)).budget.reserved).toBe(0);
    expect((await quotes.findOne({ id: q.id }).lean())?.status).toBe('quoted');
  });
  it('does not release ambiguous paid reservations when the model configuration changes', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    tasks.createTask.mockRejectedValueOnce(new Error('response lost'));
    await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('response lost');
    await configs.updateOne({}, { $inc: { revision: 1 } });
    await expect(service.confirm('owner', p.id, q.id)).rejects.toThrow('提交结果尚待核实');
    const reopened = await service.get('owner', p.id);
    expect(reopened.budget?.reserved).toBe(2); expect(reopened.pendingRequests).toHaveLength(1);
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
  });
  it('keeps unfunded attempts recoverable without exposing internal billing identifiers', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    tasks.createTask.mockRejectedValue(new InsufficientBalanceException('portal:private-id', 2));
    const failed = await service.confirm('owner', p.id, q.id);
    expect(failed.candidates[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('此项需要 2 积分') });
    expect(failed.candidates[0].taskId).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain('private-id');
    // Old stored provider messages are translated without rewriting audit history.
    await candidates.updateOne({ id: failed.candidates[0].id }, { $set: { error: 'Insufficient balance for client portal:legacy-id, required: 2' } });
    const reopened = await service.get('owner', p.id);
    expect(reopened.candidates[0].error).toContain('请联系管理员');
    expect(JSON.stringify(reopened)).not.toContain('legacy-id');
    expect(reopened.plan).toEqual(failed.plan);
    await service.confirm('owner', p.id, q.id);
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
  });
  it('explains upstream authentication failure without removing the saved story', async () => {
    const p = await project(), q = await service.quote('owner', p.id, 'character', ['girl']);
    tasks.getTask.mockResolvedValue({ status: 'FAILED', error: { code: 'AKOOL_401', message: 'Request failed with status code 401 | "Invalid Token"' } });
    const failed = await service.confirm('owner', p.id, q.id);
    expect(failed.candidates[0]).toMatchObject({ status: 'failed', taskId: 'task-real', error: expect.stringContaining('检查供应商凭证') });
    expect(failed.plan).toEqual(p.plan);
  });
});
