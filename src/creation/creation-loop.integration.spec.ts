import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection, Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreationTemplateSubmission, CreationTemplateSubmissionSchema } from './creation-template.schema';
import { CreationTemplateService } from './creation-template.service';
import { TemplateInsightsService } from './template-insights.service';
import { CreationTemplateController } from './creation-template.controller';
import { DramaTemplateCatalogController } from '../short-drama/drama-template-catalog.controller';
import { DramaWorkflowLink, DramaWorkflowLinkSchema } from './drama-workflow.schema';
import { DramaWorkflowService } from './drama-workflow.service';
import { Workflow, WorkflowSchema } from '../database/schemas/workflow.schema';
import { WorkflowRun, WorkflowRunSchema } from '../database/schemas/workflow-run.schema';
import { WorkflowTemplate, WorkflowTemplateSchema } from '../database/schemas/workflow-template.schema';
import { WorkflowAsset, WorkflowAssetSchema } from '../database/schemas/workflow-asset.schema';
import { ModelConfig, ModelConfigSchema } from '../database/schemas/model-config.schema';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema, ShortDramaQuote, ShortDramaQuoteSchema } from '../short-drama/drama.schema';
import { ShortDramaService } from '../short-drama/drama.service';
import { templatePlan } from '../short-drama/drama-templates';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowExecutionService } from '../workflow/workflow-execution.service';
import { ExecutionGraphResolver } from '../workflow/execution-graph.resolver';
import { ResponseTransformInterceptor } from '../common/interceptors/response-transform.interceptor';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { AdminCreationTemplateController } from '../admin/admin-creation-template.controller';
import { AdminAuthService } from '../admin/admin-auth.service';
import { PermissionCheckService } from '../admin/permission-check.service';
import { CreationEvent, CreationEventSchema } from './creation-event.schema';
import { CreationEventService } from './creation-event.service';
import { CreationEventController } from './creation-event.controller';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';

describe('Creation product loop with isolated database and no paid providers', () => {
  let mongo: MongoMemoryServer, db: Connection, app: INestApplication, base: string;
  let submissions: Model<CreationTemplateSubmission>, templates: Model<WorkflowTemplate>, workflows: Model<Workflow>, runs: Model<WorkflowRun>;
  let projects: Model<ShortDramaProject>, candidates: Model<ShortDramaCandidate>, links: Model<DramaWorkflowLink>;
  let events: Model<CreationEvent>, eventService: CreationEventService, templateService: WorkflowTemplateService, configs: Model<ModelConfig>;
  let service: CreationTemplateService, dramas: ShortDramaService, workflowService: WorkflowService, bridge: DramaWorkflowService, execution: WorkflowExecutionService;
  const tasks = { createTask: jest.fn(), getTask: jest.fn(), cancelTask: jest.fn() };
  const policy = { assertCanCreate: jest.fn().mockResolvedValue(false), assertNodesAllowed: jest.fn(), releaseWorkflowSlot: jest.fn(), acquireRun: jest.fn().mockResolvedValue({ acquired: false, timeoutSeconds: 300 }), releaseRun: jest.fn() };
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) };
  const input = (kind: 'workflow' | 'short-drama', sourceId: string) => ({ kind, sourceId, name: '可复用模板', description: '适合初次创作', instructions: '先检查故事与素材，然后生成。' });
  async function http(path: string, body?: unknown, owner?: string) {
    const result = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: owner } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, body: await result.json() as any };
  }
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); db = await createConnection(mongo.getUri()).asPromise();
    submissions = db.model(CreationTemplateSubmission.name, CreationTemplateSubmissionSchema); templates = db.model(WorkflowTemplate.name, WorkflowTemplateSchema);
    workflows = db.model(Workflow.name, WorkflowSchema); runs = db.model(WorkflowRun.name, WorkflowRunSchema);
    projects = db.model(ShortDramaProject.name, ShortDramaProjectSchema); candidates = db.model(ShortDramaCandidate.name, ShortDramaCandidateSchema);
    links = db.model(DramaWorkflowLink.name, DramaWorkflowLinkSchema);
    const quotes = db.model(ShortDramaQuote.name, ShortDramaQuoteSchema), assets = db.model(WorkflowAsset.name, WorkflowAssetSchema);
    configs = db.model(ModelConfig.name, ModelConfigSchema); events = db.model(CreationEvent.name, CreationEventSchema); await events.init();
    eventService = new CreationEventService(events, templates, submissions, projects, candidates, quotes);
    templateService = new WorkflowTemplateService(templates as any, undefined, configs as any);
    await Promise.all([submissions.init(), templates.init(), workflows.init(), candidates.init(), links.init()]);
    dramas = new ShortDramaService(projects, candidates, quotes, configs, assets, {} as any, tasks as any, policy as any, undefined, undefined, submissions);
    workflowService = new WorkflowService(workflows as any, new EventEmitter2(), policy as any);
    service = new CreationTemplateService(submissions, templates, workflowService, dramas);
    bridge = new DramaWorkflowService(links, runs, candidates, dramas, workflowService, templateService);
    execution = new WorkflowExecutionService(runs as any, workflows as any, queue as any, new ExecutionGraphResolver(), new EventEmitter2(), { findExecutionBillingKey: async () => 'isolated-key' } as any, tasks as any, policy as any, links);
    const module = await Test.createTestingModule({ controllers: [CreationEventController, CreationTemplateController, DramaTemplateCatalogController, AdminCreationTemplateController], providers: [
      { provide: CreationEventService, useValue: eventService },
      { provide: CreationTemplateService, useValue: service },
      { provide: TemplateInsightsService, useValue: new TemplateInsightsService(workflows, projects, templates, submissions) },
      { provide: AdminAuthService, useValue: { verifyToken: (token: string) => ({ sub: token, roles: token === 'user' ? ['user'] : ['admin'] }) } },
      { provide: PermissionCheckService, useValue: { checkAllPermissions: async (id: string, codes: string[]) => id === 'reviewer' || id === 'reader' && codes.every(code => code === 'workflow:read') } },
    ] })
      .overrideGuard(ApiKeyOrJwtGuard).useValue({ canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); if (!req.headers.authorization) return false; req.apiClient = { userId: req.headers.authorization }; return true; } }).compile();
    app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  }, 60000);
  afterAll(async () => { await app?.close(); await db?.close(); await mongo?.stop(); });
  beforeEach(async () => { jest.clearAllMocks(); delete process.env.DRAMA_TEMPLATES_ENABLED; delete process.env.DRAMA_CREATE_ENABLED; delete process.env.DRAMA_GENERATION_ENABLED; await Promise.all([submissions.deleteMany({}), templates.deleteMany({}), workflows.deleteMany({}), runs.deleteMany({}), projects.deleteMany({}), candidates.deleteMany({}), links.deleteMany({})]); });
  afterEach(async () => { delete process.env.DRAMA_TEMPLATES_ENABLED; delete process.env.DRAMA_CREATE_ENABLED; delete process.env.DRAMA_GENERATION_ENABLED; await events.deleteMany({}); await configs.deleteMany({}); });

  it('deduplicates operation events, rejects fabricated success and verifies owned references', async () => {
    const input = { name: 'template_view', kind: 'short-drama', templateId: 'letter-story-v1', sessionId: 'f50c7846-cf31-4b7c-a3c4-56718a849c08' };
    expect((await http('/v1/creation-events/public', input)).status).toBe(201);
    await http('/v1/creation-events/public', input);
    expect((await eventService.funnel('short-drama')).counts.template_view).toBe(1);
    expect((await http('/v1/creation-events/public', { ...input, name: 'generation_succeeded' })).status).toBe(400);
    expect((await http('/v1/creation-events/public', { ...input, script: 'private text' })).status).toBe(400);
    expect((await http('/v1/creation-events/public', { ...input, templateId: 'missing' })).status).toBe(404);
    const p = await dramas.create('owner', templatePlan('letter-story-v1'));
    const body = { name: 'download_started', projectId: p.id, referenceId: 'export' };
    expect((await http('/v1/creation-events', body)).status).toBe(403);
    await candidates.create({ id: 'export', ownerId: 'owner', projectId: p.id, kind: 'export', targetId: 'project', source: 'render', status: 'succeeded', url: 'https://test.invalid/export.mp4' });
    expect((await http('/v1/creation-events', body, 'other')).status).toBe(404);
    expect((await http('/v1/creation-events', body, 'owner')).status).toBe(201);
    expect((await eventService.funnel('short-drama')).counts.download_started).toBe(1);
    const stored = JSON.stringify(await events.find().lean()); expect(stored).not.toContain(input.sessionId); expect(stored).not.toContain('test.invalid');
  });

  it('appends stage templates atomically with remapped references and immutable version provenance', async () => {
    const p = await dramas.create('owner', templatePlan('letter-story-v1'));
    const result = await dramas.applyStageTemplate('owner', p.id, 0, 'letter-story-v1', 'storyboard');
    expect(result.plan.shots).toHaveLength(4); expect(result.plan.shots[0]).toEqual(p.plan.shots[0]);
    expect(new Set(result.plan.shots.map(s => s.id)).size).toBe(4);
    expect(result.plan.shots[2].characterIds[0]).not.toBe(p.plan.characters[0].id);
    expect(result.plan.characters.some(c => c.id === result.plan.shots[2].characterIds[0])).toBe(true);
    expect((await projects.findOne({ id: p.id }))!.stageTemplates[0]).toMatchObject({ id: 'letter-story-v1', version: 1, stage: 'storyboard', revision: 1 });
    await expect(dramas.applyStageTemplate('owner', p.id, 0, 'letter-story-v1', 'characters')).rejects.toThrow('已更新');
    await expect(dramas.applyStageTemplate('other', p.id, 1, 'letter-story-v1', 'characters')).rejects.toThrow();
    await projects.updateOne({ id: p.id }, { $set: { 'plan.characters': Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: '角色', description: '设定' })), 'plan.shots': [] } });
    await expect(dramas.applyStageTemplate('owner', p.id, 1, 'letter-story-v1', 'characters')).rejects.toThrow('最多 8');
    expect((await projects.findOne({ id: p.id }))!.revision).toBe(1);
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it('copies a published workflow into an owned shot flow and detects stale/disabled model configurations', async () => {
    const model = await configs.create({ model_id: 'fixture', model_name: 'Fixture', model_type: 'textToImage', provider: 'fixture', revision: 2 });
    const template = await templates.create({ name: '镜头模板', category: 'Creative', isPublic: true, version: 3, workflowDefinition: { name: '镜头模板', nodes: [{ id: 'image', type: 'text-to-image', position: { x: 0, y: 0 }, data: { modelId: 'fixture', modelSelection: { configId: String(model._id), configRevision: 1, featureType: 'textToImage' }, parameters: { prompt: 'portable', image: 'https://private.invalid/image.png' } } }], edges: [] } });
    expect((await templateService.compatibility(template)).runnable).toBe(false);
    await templates.updateOne({ _id: template._id }, { $set: { 'workflowDefinition.nodes.0.data.modelSelection.configRevision': 2 } });
    expect((await templateService.compatibility((await templates.findById(template._id))!)).runnable).toBe(true);
    await configs.updateOne({ _id: model._id }, { $set: { disabled: true } });
    expect((await templateService.compatibility((await templates.findById(template._id))!)).runnable).toBe(false);
    const p = await dramas.create('owner', templatePlan('letter-story-v1'));
    const link = await bridge.create('owner', { projectId: p.id, shotId: p.plan.shots[0].id, revision: 0, kind: 'image', templateId: String(template._id) });
    const flow = await workflowService.findById(link.workflowId, 'owner'); expect(flow!.templateSource).toMatchObject({ id: String(template._id), version: 3 });
    expect(flow!.nodes[0].id).toBe('image'); expect(JSON.stringify(flow)).not.toContain('private.invalid');
    await templates.updateOne({ _id: template._id }, { $set: { isPublic: false } });
    await expect(bridge.create('owner', { projectId: p.id, shotId: p.plan.shots[0].id, revision: 0, kind: 'image', templateId: String(template._id) })).rejects.toThrow('已下架');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it('lets visitors preview templates without execution/private data and enforces pagination and flags', async () => {
    const list = await http('/v1/catalog/drama-templates?pageSize=1'); expect(list.status).toBe(200); expect(list.body.data.items).toHaveLength(1); expect(list.body.data.total).toBe(2);
    const detail = await http('/v1/catalog/drama-templates/letter-story-v1'); expect(detail.body.data.shots).toHaveLength(2);
    expect(JSON.stringify(detail.body)).not.toMatch(/ownerId|production|configId|billing|assetId/);
    expect((await http('/v1/catalog/drama-templates?pageSize=99')).status).toBe(400);
    expect((await http('/v1/catalog/drama-templates?search=%5B')).body.data.total).toBe(0);
    expect((await http('/v1/catalog/drama-templates/missing')).status).toBe(404);
    process.env.DRAMA_TEMPLATES_ENABLED = 'false'; expect((await http('/v1/catalog/drama-templates')).body.data.total).toBe(0); expect((await http('/v1/catalog/drama-templates/letter-story-v1')).status).toBe(404);
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('keeps submissions private, strips selections and reuses an immutable snapshot until an admin publishes', async () => {
    const plan = templatePlan('letter-story-v1')!; plan.characters[0].selected = 'private-reference'; plan.shots[0].video = 'private-video';
    const project = await projects.create({ id: 'f50c7846-cf31-4b7c-a3c4-56718a849c08', ownerId: 'owner', revision: 3, plan });
    expect((await http('/v1/creation-templates/submissions', input('short-drama', project.id))).status).toBe(403);
    await expect(service.submit('other', input('short-drama', project.id))).rejects.toThrow();
    const a = await service.submit('owner', input('short-drama', project.id)); const b = await service.submit('owner', input('short-drama', project.id)); expect(String(a!._id)).toBe(String(b!._id)); expect(a).not.toHaveProperty('dramaPlan');
    const snapshot = await service.detail(String(a!._id)); expect(JSON.stringify(snapshot.dramaPlan)).not.toMatch(/private-reference|private-video/); expect(snapshot.dramaPlan!.production!.models).toEqual({});
    expect((await http('/v1/catalog/drama-templates')).body.data.total).toBe(2);
    await service.review(String(a!._id), 'publish', '已检查故事结构');
    const detail = await http('/v1/catalog/drama-templates/' + a!._id); expect(detail.body.data.source).toBe('community');
    const copy = await dramas.fromTemplate('other', String(a!._id)); expect(copy.id).not.toBe(project.id); expect(copy.plan.shots).toHaveLength(2); expect(copy.candidates).toEqual([]);
    await service.review(String(a!._id), 'withdraw', '更新中'); expect((await http('/v1/catalog/drama-templates/' + a!._id)).status).toBe(404); await expect(dramas.fromTemplate('owner', String(a!._id))).rejects.toThrow(); expect((await dramas.get('other', copy.id)).plan.shots).toHaveLength(2);
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('publishes workflow snapshots without private media/defaults/secrets and preserves independent copies', async () => {
    const flow = await workflowService.create({ name: '私有流程', nodes: [{ id: 'n', type: 'text-to-image', position: { x: 1, y: 1 }, data: { modelId: 'test-image', parameters: { prompt: 'studio', image: 'https://private.test/asset.png', apiKey: 'fixture-secret' } } }], edges: [], inputSchema: { image: { type: 'image', required: true, default: 'https://private.test/input.png' } } }, 'owner');
    await expect(service.submit('other', input('workflow', String(flow._id)))).rejects.toThrow();
    const submission = await service.submit('owner', input('workflow', String(flow._id))); await service.review(String(submission!._id), 'publish', '已检查'); await service.review(String(submission!._id), 'publish', '重复确认');
    expect(await templates.countDocuments({})).toBe(1);
    const published = await templates.findById(submission!._id).lean(); expect(JSON.stringify(published)).not.toMatch(/private\.test|fixture-secret/); expect(published!.workflowDefinition.nodes[0].data.parameters).toEqual({ prompt: 'studio' });
    await workflowService.update(String(flow._id), { name: '源流程后续修改' }, 'owner'); expect((await templates.findById(submission!._id))!.name).toBe('可复用模板');
    await service.review(String(submission!._id), 'reject', '需要补充说明'); expect((await templates.findById(submission!._id))!.isPublic).toBe(false);
  });
  it('allows template review only for authorized admins with workflow update permission', async () => {
    const project = await dramas.create('owner', templatePlan('letter-story-v1'));
    const submission = await service.submit('owner', input('short-drama', project.id));
    const review = async (token?: string) => fetch(`${base}/api/v1/admin/creation-templates/${submission!._id}/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'publish', note: '已核对' }) });
    expect((await review()).status).toBe(401);
    expect((await review('reader')).status).toBe(403);
    expect((await review('user')).status).toBe(403);
    expect((await submissions.findById(submission!._id))!.status).toBe('pending');
    expect((await review('reviewer')).status).toBe(200);
    expect((await http('/v1/catalog/drama-templates/' + submission!._id)).status).toBe(200);
    const insights = (token?: string, query = '') => fetch(`${base}/api/v1/admin/creation-templates/insights${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect((await insights()).status).toBe(401); expect((await insights('user')).status).toBe(403); expect((await insights('reader')).status).toBe(200);
    expect((await insights('reader', '?kind=invalid')).status).toBe(400); expect((await insights('reader', '?page=0')).status).toBe(400);
  });
  it('links a shot, imports only owned matching outputs once, and preserves the selected take', async () => {
    const p = await dramas.create('owner', templatePlan('letter-story-v1'));
    const link = await bridge.create('owner', { projectId: p.id, shotId: p.plan.shots[0].id, kind: 'image', revision: p.revision });
    const run = await runs.create({ runId: 'owned-run', workflowId: link.workflowId, workflowVersion: 4, triggerId: 'owner', parentTaskId: 'parent', status: 'succeeded', nodeStates: [{ nodeId: 'shot', status: 'succeeded', output: { image: 'https://cdn.test/output.png' } }] });
    await expect(bridge.importOutput('other', link.id, { runId: run.runId, nodeId: 'shot' })).rejects.toThrow();
    const result = await bridge.importOutput('owner', link.id, { runId: run.runId, nodeId: 'shot' }); await bridge.importOutput('owner', link.id, { runId: run.runId, nodeId: 'shot' });
    expect(await candidates.countDocuments({ projectId: p.id })).toBe(1); expect(result.candidate.workflowOrigin).toMatchObject({ workflowVersion: 4, runId: 'owned-run', sourceRevision: p.revision });
    expect((await dramas.get('owner', p.id)).plan.shots[0].image).toBeUndefined();
    await runs.create({ runId: 'foreign-run', workflowId: link.workflowId, workflowVersion: 1, triggerId: 'other', parentTaskId: 'foreign', status: 'succeeded', nodeStates: [] });
    await expect(bridge.importOutput('owner', link.id, { runId: 'foreign-run', nodeId: 'shot' })).rejects.toThrow('运行记录不存在');
    await expect(bridge.importOutput('owner', link.id, { runId: run.runId, nodeId: 'missing' })).rejects.toThrow('请选择');
    await projects.updateOne({ id: p.id }, { $set: { 'plan.shots.0.description': '已经修改的镜头' } });
    await expect(bridge.importOutput('owner', link.id, { runId: run.runId, nodeId: 'shot' })).rejects.toThrow('已更新');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
  it('freezes linked workflow runs and blocks new runs/retries while short-drama generation is paused', async () => {
    const p = await dramas.create('owner', templatePlan('letter-story-v1'));
    const link = await bridge.create('owner', { projectId: p.id, shotId: p.plan.shots[0].id, kind: 'image', revision: 0 });
    const original = await workflowService.findById(link.workflowId, 'owner');
    await workflowService.update(link.workflowId, { nodes: original!.nodes.map(n => ({ ...n, data: { ...n.data, modelId: 'fixture-image' } })) }, 'owner');
    const started = await execution.run(link.workflowId, {}, 'owner');
    const stored = await runs.findOne({ runId: started.runId }).lean(); expect(stored!.definitionSnapshot!.nodes[0].data.parameters!.prompt).toContain(p.plan.shots[0].description); expect(stored!.definitionHash).toHaveLength(64);
    await workflowService.update(link.workflowId, { nodes: [{ id: 'changed', type: 'input', position: { x: 0, y: 0 }, data: {} }] }, 'owner');
    expect((await runs.findOne({ runId: started.runId }))!.definitionSnapshot!.nodes[0].id).toBe('shot');
    process.env.DRAMA_GENERATION_ENABLED = 'false'; await expect(execution.run(link.workflowId, {}, 'owner')).rejects.toThrow('暂时暂停'); await runs.updateOne({ runId: started.runId }, { $set: { status: 'failed' } }); await expect(execution.retry(started.runId, 'owner')).rejects.toThrow('暂时暂停');
    await expect(bridge.create('owner', { projectId: p.id, shotId: p.plan.shots[0].id, kind: 'image', revision: 0 })).rejects.toThrow('暂时暂停');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
});
