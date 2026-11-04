import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { randomUUID } from 'crypto';
import { WorkflowRun, WorkflowRunSchema } from '../database/schemas/workflow-run.schema';
import { Workflow, WorkflowSchema } from '../database/schemas/workflow.schema';
import { PortalNotificationController } from './portal-notification.controller';
import { PortalNotificationService } from './portal-notification.service';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalAuthService } from './portal-auth.service';
import { ResponseTransformInterceptor } from '../common/interceptors/response-transform.interceptor';
import { ShortDramaProject, ShortDramaProjectSchema, ShortDramaCandidate, ShortDramaCandidateSchema } from '../short-drama/drama.schema';
import { emptyDramaPlan } from '../short-drama/drama.types';

describe('Portal notifications (HTTP + MongoDB)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let runs: Model<WorkflowRun>;
  let workflows: Model<Workflow>;
  let service: PortalNotificationService;
  let base: string;
  let workflowId: string;
  let drama: Model<ShortDramaCandidate>, projects: Model<ShortDramaProject>;
  const auth = {
    verifyAccessToken: (token: string) => {
      if (!['owner-a', 'owner-b', 'disabled'].includes(token)) throw new Error();
      return { sub: token };
    },
    getUserById: async (id: string) => ({ id, status: id === 'disabled' ? 'disabled' : 'active' }),
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), MongooseModule.forFeature([
        { name: WorkflowRun.name, schema: WorkflowRunSchema },
        { name: Workflow.name, schema: WorkflowSchema },
        { name: ShortDramaCandidate.name, schema: ShortDramaCandidateSchema },
        { name: ShortDramaProject.name, schema: ShortDramaProjectSchema },
      ])],
      controllers: [PortalNotificationController],
      providers: [PortalNotificationService, PortalJwtGuard, { provide: PortalAuthService, useValue: auth }],
    }).compile();
    runs = module.get(getModelToken(WorkflowRun.name));
    workflows = module.get(getModelToken(Workflow.name));
    service = module.get(PortalNotificationService);
    drama = module.get(getModelToken(ShortDramaCandidate.name)); projects = module.get(getModelToken(ShortDramaProject.name));
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1/notifications`;
  }, 60000);

  afterAll(async () => { await app?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    await Promise.all([runs.deleteMany({}), workflows.deleteMany({}), drama.deleteMany({}), projects.deleteMany({})]);
    const workflow = await workflows.create({ name: 'Owned workflow', creatorId: 'owner-a', nodes: [], edges: [] });
    workflowId = String(workflow._id);
  });

  const request = (path = '', method = 'GET', user = 'owner-a') => fetch(base + path, {
    method, headers: user ? { Authorization: `Bearer ${user}` } : {},
  });
  const makeRun = (override: Partial<WorkflowRun> = {}) => runs.create({
    runId: randomUUID(), workflowId, workflowVersion: 0, triggerId: 'owner-a', parentTaskId: randomUUID(),
    status: 'succeeded', completedAt: new Date(Date.now() - 1000), ...override,
  });

  it('isolates users, paginates, filters terminal runs, and never exposes run secrets or raw errors', async () => {
    const first = await makeRun({ status: 'failed', error: { code: 'private', message: 'secret-provider-url' }, executionApiKey: 'private-key', input: { prompt: 'private prompt' } });
    await makeRun({ status: 'cancelled' });
    await makeRun({ triggerId: 'owner-b' });
    await makeRun({ status: 'running' });
    await makeRun({ status: 'succeeded', completedAt: undefined });
    const response = await request('?pageSize=1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ total: 2, unreadCount: 2, page: 1, pageSize: 1 });
    const next = await (await request('?pageSize=1&page=2')).json();
    expect(body.data.items[0].id).not.toEqual(next.data.items[0].id);
    expect(body.data.items[0].href).toEqual(`/workflows/${workflowId}`);
    expect(JSON.stringify([body, next])).not.toMatch(/secret-provider-url|private-key|private prompt|triggerId|nodeStates/);
    expect((await (await request('/unread-count', 'GET', 'owner-b')).json()).data.count).toBe(1);
    expect((await request(`/${first.runId}/read`, 'PUT', 'owner-b')).status).toBe(404);
    expect(await service.unreadCount('owner-a')).toBe(2);
  });

  it('persists single/all read state, keeps running jobs untouched, and makes a retried completion unread', async () => {
    const first = await makeRun({ status: 'failed' });
    const second = await makeRun();
    const other = await makeRun({ triggerId: 'owner-b' });
    const running = await makeRun({ status: 'running', completedAt: undefined });
    expect((await (await request(`/${first.runId}/read`, 'PUT')).json()).data.count).toBe(1);
    const readAt = (await runs.findById(first._id))?.notificationReadAt;
    expect(readAt).toEqual(first.completedAt);
    expect((await request(`/${first.runId}/read`, 'PUT')).status).toBe(200);
    const filtered = await (await request('?unreadOnly=true')).json();
    expect(filtered.data.items.map((item: { id: string }) => item.id)).toEqual([second.runId]);
    const all = await (await request('/read-all', 'PUT')).json();
    expect(all.data).toEqual({ modifiedCount: 1, count: 0 });
    expect((await runs.findById(other._id))?.notificationReadAt).toBeUndefined();
    expect((await runs.findById(running._id))?.notificationReadAt).toBeUndefined();
    // Reconstruct the service, as after restart: acknowledged state stays read.
    expect(await new PortalNotificationService(runs as any, workflows as any).unreadCount('owner-a')).toBe(0);
    await runs.updateOne({ _id: first._id }, { $set: { status: 'running' }, $unset: { completedAt: 1 } });
    expect(await service.unreadCount('owner-a')).toBe(0);
    await runs.updateOne({ _id: first._id }, { $set: { status: 'succeeded', completedAt: new Date() } });
    expect(await service.unreadCount('owner-a')).toBe(1);
  });

  it('keeps notifications when a workflow is deleted, without linking to another owner’s workflow', async () => {
    await makeRun();
    await workflows.updateOne({ _id: workflowId }, { $set: { creatorId: 'owner-b', name: 'Private name' } });
    let data = await service.list('owner-a', 1, 8);
    expect(data.items[0]).toMatchObject({ workflowName: null, href: null });
    expect(JSON.stringify(data)).not.toContain('Private name');
    await workflows.deleteOne({ _id: workflowId });
    data = await service.list('owner-a', 1, 8);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].href).toBeNull();
  });

  it('rejects unauthenticated/disabled callers, invalid IDs, invalid paging and owner overrides', async () => {
    for (const methodPath of [['GET', ''], ['GET', '/unread-count'], ['PUT', '/read-all'], ['PUT', `/${randomUUID()}/read`]]) {
      expect((await request(methodPath[1], methodPath[0], '')).status).toBe(401);
      expect((await request(methodPath[1], methodPath[0], 'disabled')).status).toBe(401);
    }
    for (const query of ['?page=0', '?page=1.5', '?page=NaN', '?pageSize=100', '?unreadOnly=bad', '?userId=owner-b']) {
      expect((await request(query)).status).toBe(400);
    }
    expect((await request('/bad-id/read', 'PUT')).status).toBe(400);
    expect((await request(`/${randomUUID()}/read`, 'PUT')).status).toBe(404);
  });
  it('merges drama completions with workflow results and persists owner-scoped read state', async () => {
    await makeRun({ completedAt: new Date(Date.now() - 10000) });
    const id = randomUUID(), candidateId = randomUUID();
    await projects.create({ id, ownerId: 'owner-a', plan: { ...emptyDramaPlan(), title: '我的短剧' } });
    await drama.create({ id: candidateId, ownerId: 'owner-a', projectId: id, kind: 'export', targetId: 'project', source: 'render', status: 'succeeded', completedAt: new Date(), url: 'https://private.invalid/result.mp4' });
    const first = await service.list('owner-a', 1, 1);
    expect(first).toMatchObject({ total: 2, unreadCount: 2 });
    expect(first.items[0]).toMatchObject({ id: candidateId, type: 'drama_result', href: `/short-dramas/${id}`, workflowName: '我的短剧' });
    expect(JSON.stringify(first)).not.toContain('private.invalid');
    expect((await service.list('owner-a', 2, 1)).items[0].type).toBe('workflow_run');
    await expect(service.markRead('owner-b', candidateId)).rejects.toThrow('not found');
    await service.markRead('owner-a', candidateId); expect(await service.unreadCount('owner-a')).toBe(1);
    await service.markAllRead('owner-a'); expect(await service.unreadCount('owner-a')).toBe(0);
    await drama.updateOne({ id: candidateId }, { $set: { archiveStatus: 'archived' } });
    expect(await service.unreadCount('owner-a')).toBe(0);
  });
});
