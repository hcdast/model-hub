import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection, Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Workflow, WorkflowSchema } from '../database/schemas/workflow.schema';
import { WorkflowTemplate, WorkflowTemplateSchema } from '../database/schemas/workflow-template.schema';
import { WorkflowRun, WorkflowRunSchema } from '../database/schemas/workflow-run.schema';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema } from '../short-drama/drama.schema';
import { CreationTemplateSubmission, CreationTemplateSubmissionSchema } from './creation-template.schema';
import { TemplateInsightsService, recommendationScore } from './template-insights.service';
import { CreationTemplateService } from './creation-template.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { WorkflowTemplateCatalogController } from '../workflow/workflow-template-catalog.controller';
import { DramaTemplateCatalogController } from '../short-drama/drama-template-catalog.controller';
import { WorkflowController } from '../workflow/workflow.controller';
import { WorkflowService } from '../workflow/workflow.service';
import { templatePlan } from '../short-drama/drama-templates';

describe('Template recommendations and authoritative project funnel', () => {
  let mongo: MongoMemoryServer, db: Connection;
  let flows: Model<Workflow>, templates: Model<WorkflowTemplate>, runs: Model<WorkflowRun>, projects: Model<ShortDramaProject>, candidates: Model<ShortDramaCandidate>, submissions: Model<CreationTemplateSubmission>;
  let insights: TemplateInsightsService, templateService: WorkflowTemplateService;
  const definition = { name: 'Template', nodes: [{ id: 'n', type: 'input', position: { x: 0, y: 0 }, data: {} }], edges: [] };
  const flow = (templateId: string, creatorId = 'owner') => flows.create({ ...definition, creatorId, templateSource: { id: templateId, version: 2 } });
  const run = (workflowId: unknown, triggerId: string, runId: string, status: string) => runs.create({ workflowId: String(workflowId), triggerId, runId, workflowVersion: 1, status, parentTaskId: runId, nodeStates: [] });
  const project = (id: string, ownerId = 'owner', templateId = 'letter-story-v1', archived = false) => projects.create({ id, ownerId, plan: templatePlan('letter-story-v1'), templateSource: { id: templateId, version: 1 }, archived });
  const candidate = (projectId: string, id: string, kind: string, source: string, status: string, ownerId = 'owner') => candidates.create({ projectId, id, ownerId, kind, source, status, targetId: 'project' });
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); db = await createConnection(mongo.getUri()).asPromise();
    flows = db.model(Workflow.name, WorkflowSchema); templates = db.model(WorkflowTemplate.name, WorkflowTemplateSchema); runs = db.model(WorkflowRun.name, WorkflowRunSchema);
    projects = db.model(ShortDramaProject.name, ShortDramaProjectSchema); candidates = db.model(ShortDramaCandidate.name, ShortDramaCandidateSchema); submissions = db.model(CreationTemplateSubmission.name, CreationTemplateSubmissionSchema);
  }, 60000);
  beforeEach(async () => {
    await Promise.all(([flows, templates, runs, projects, candidates, submissions] as Model<any>[]).map(model => model.deleteMany({})));
    insights = new TemplateInsightsService(flows, projects, templates, submissions);
    templateService = new WorkflowTemplateService(templates as any, insights);
  });
  afterEach(() => { delete process.env.DRAMA_TEMPLATES_ENABLED; delete process.env.DRAMA_CREATE_ENABLED; jest.restoreAllMocks(); });
  afterAll(async () => { await db?.close(); await mongo?.stop(); });

  it('counts each owned workflow once per stage and each creator once despite retries and duplicate copies', async () => {
    const [a, b, c, legacy] = await Promise.all([flow('known'), flow('known'), flow('known', 'second-owner'), flows.create({ ...definition, creatorId: 'owner' })]);
    await Promise.all([run(a._id, 'owner', 'failed', 'failed'), run(a._id, 'owner', 'retry', 'succeeded'), run(a._id, 'owner', 'retry-again', 'succeeded'), run(b._id, 'foreign-owner', 'foreign', 'succeeded'), run(c._id, 'second-owner', 'running', 'running'), run(legacy._id, 'owner', 'legacy', 'succeeded')]);
    const result = await insights.metrics('workflow');
    expect(result.metrics.get('known')).toEqual({ copies: 3, creators: 2, startedProjects: 2, completedProjects: 1, startedCreators: 2, completedCreators: 1 });
    expect(result.metrics.size).toBe(1);
    const overview = await insights.overview('workflow'); expect(overview.totals).toEqual({ copies: 3, startedProjects: 2, completedProjects: 1 });
    expect(overview.items[0]).toMatchObject({ id: 'known', published: false, name: '已删除或不可用的模板' });
    expect(JSON.stringify(overview)).not.toMatch(/foreign-owner|second-owner|nodeStates|parentTaskId/);
  });

  it('requires a successful render for drama completion, excludes uploads and preserves archived projects', async () => {
    await Promise.all([project('first'), project('second'), project('archived', 'another', 'letter-story-v1', true)]);
    await Promise.all([candidate('first', 'failed-model', 'image', 'model', 'failed'), candidate('first', 'first-export', 'export', 'render', 'succeeded'), candidate('first', 're-export', 'export', 'render', 'succeeded'), candidate('second', 'upload', 'image', 'upload', 'succeeded'), candidate('second', 'foreign-export', 'export', 'render', 'succeeded', 'foreign'), candidate('archived', 'pending-model', 'image', 'model', 'pending', 'another')]);
    const result = await insights.metrics('short-drama'); expect(result.metrics.get('letter-story-v1')).toEqual({ copies: 3, creators: 2, startedProjects: 2, completedProjects: 1, startedCreators: 2, completedCreators: 1 });
    await projects.deleteOne({ id: 'first' });
    const fresh = new TemplateInsightsService(flows, projects, templates, submissions);
    expect((await fresh.metrics('short-drama')).metrics.get('letter-story-v1')!.copies).toBe(2);
    expect((await fresh.metrics('short-drama')).metrics.get('letter-story-v1')!.completedProjects).toBe(0);
  });

  it('ranks completion above repeated copies and filters unpublished workflow templates before pagination', async () => {
    const [popular, completed, privateTemplate] = await templates.create([
      { name: 'Repeated copies', category: 'Image', isPublic: true, workflowDefinition: definition, source: 'community' },
      { name: 'Completed work', category: 'Video', isPublic: true, workflowDefinition: definition, source: 'official' },
      { name: 'Private template', category: 'Video', isPublic: false, workflowDefinition: definition },
    ]);
    await Promise.all(Array.from({ length: 10 }, () => flow(String(popular._id))));
    const successful = await flow(String(completed._id), 'finisher'); await run(successful._id, 'finisher', 'done', 'succeeded');
    const secret = await flow(String(privateTemplate._id), 'hidden'); await run(secret._id, 'hidden', 'secret', 'succeeded');
    const controller = new WorkflowTemplateCatalogController(templateService, insights);
    const first = await controller.list({ order: 'recommended', pageSize: 1, page: 1 }); expect(first.total).toBe(2); expect(first.items[0].name).toBe('Completed work');
    const next = await controller.list({ order: 'recommended', pageSize: 1, page: 2 }); expect(next.items[0].name).toBe('Repeated copies'); expect(next.items[0].metrics.creators).toBe(1);
    const filtered = await controller.list({ order: 'recommended', source: 'community', search: 'Repeated' }); expect(filtered.items.map(t => t.name)).toEqual(['Repeated copies']);
    expect(JSON.stringify(first)).not.toMatch(/hidden|finisher|creatorId|workflowDefinition|parentTaskId/);
    expect(recommendationScore(first.items[0].metrics)).toBeGreaterThan(recommendationScore(next.items[0].metrics));
  });

  it('mixes published community stories with official templates and enforces source filters and feature flags', async () => {
    const published = await submissions.create({ ownerId: 'author', kind: 'short-drama', sourceId: 'source', sourceRevision: 1, sourceFingerprint: 'snapshot', name: 'Community story', description: 'Reusable shots', instructions: 'Edit first', status: 'published', dramaPlan: templatePlan('letter-story-v1') });
    await submissions.create({ ownerId: 'author', kind: 'short-drama', sourceId: 'private', sourceRevision: 1, sourceFingerprint: 'private', name: 'Private story', description: 'Not public', instructions: 'None', status: 'withdrawn', dramaPlan: templatePlan('letter-story-v1') });
    await project('community', 'owner', String(published._id)); await candidate('community', 'rendered', 'export', 'render', 'succeeded');
    const service = new CreationTemplateService(submissions, templates, {} as any, {} as any), controller = new DramaTemplateCatalogController(service, insights);
    const page = await controller.list({ search: '', order: 'recommended', page: 1, pageSize: 1 }); expect(page.total).toBe(3); expect(page.items[0]).toMatchObject({ id: String(published._id), source: 'community', shotCount: 2, metrics: { completedProjects: 1 } });
    expect((await controller.list({ search: '', source: 'official', order: 'recommended', page: 1, pageSize: 12 })).items.every(t => t.source === 'official')).toBe(true);
    expect((await controller.list({ search: '[', source: 'community', order: 'newest', page: 1, pageSize: 12 })).total).toBe(0);
    expect(JSON.stringify(page)).not.toMatch(/ownerId|dramaPlan|production|Private story/);
    process.env.DRAMA_CREATE_ENABLED = 'false'; expect((await controller.list({ search: '', order: 'recommended', page: 1, pageSize: 12 })).items).toEqual([]);
    expect((await insights.overview('short-drama')).items.every(t => !t.published)).toBe(true);
  });

  it('assigns immutable provenance only when adopting a public template and coalesces metric queries', async () => {
    const template = await templates.create({ name: 'Adoptable', category: 'Image', isPublic: true, workflowDefinition: definition, version: 7 });
    const service = new WorkflowService(flows as any, new EventEmitter2(), { assertCanCreate: async () => false } as any);
    const controller = new WorkflowController(service, {} as any, {} as any, templateService);
    const adopted = await controller.createFromTemplate(String(template._id), 'owner'); expect(adopted.data.templateSource).toEqual({ id: String(template._id), version: 7 });
    const manual = await service.create({ ...definition, templateSource: { id: String(template._id), version: 7 } } as any, 'owner'); expect(manual.templateSource).toBeUndefined();
    const spy = jest.spyOn(flows, 'aggregate'); const [a, b] = await Promise.all([insights.metrics('workflow'), insights.metrics('workflow')]); expect(a).toBe(b); expect(spy).toHaveBeenCalledTimes(1);
    expect(a.metrics.get(String(template._id))!.copies).toBe(1);
  });
});
