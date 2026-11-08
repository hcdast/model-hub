import { BadRequestException } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection, Model } from 'mongoose';
import { WorkflowBudgetService } from './workflow-budget.service';
import { WorkflowBudgetTask, WorkflowBudgetTaskSchema } from './workflow-budget.schema';
import { DramaWorkflowLink, DramaWorkflowLinkSchema } from './drama-workflow.schema';
import { ShortDramaProject, ShortDramaProjectSchema } from '../short-drama/drama.schema';
import { WorkflowRun, WorkflowRunSchema } from '../database/schemas/workflow-run.schema';
import { ModelConfig, ModelConfigSchema } from '../database/schemas/model-config.schema';
import { BillingRecord, BillingRecordSchema } from '../database/schemas/billing-record.schema';
import { Task, TaskSchema } from '../database/schemas/task.schema';
import { budgetSummary } from '../short-drama/drama-production';
import { templatePlan } from '../short-drama/drama-templates';
import type { NodeExecutionJob } from '../workflow/node.executor';

describe('Shared short-drama budget for advanced workflow tasks', () => {
  let mongo: MongoMemoryServer, db: Connection, service: WorkflowBudgetService;
  let reservations: Model<WorkflowBudgetTask>, links: Model<DramaWorkflowLink>, projects: Model<ShortDramaProject>, runs: Model<WorkflowRun>, models: Model<ModelConfig>, bills: Model<BillingRecord>, tasks: Model<Task>;
  const billing = { resolvePolicy: jest.fn().mockResolvedValue('internal') };
  const job = (nodeId: string): NodeExecutionJob => ({ runId: 'run', nodeId, attempt: 0, nodeType: 'text-to-image', nodeData: { modelId: 'fixture', parameters: { prompt: 'test' } }, input: {}, apiKey: 'isolated-key', context: { input: {}, nodeOutputs: {} } });
  const summary = async () => budgetSummary(await projects.findOne({ id: 'project' }).lean());
  const create = (nodeId: string) => jest.fn(async (auth: any) => { await tasks.create({ taskId: nodeId, apiKey: 'isolated-key', model: 'fixture', provider: 'fixture', featureType: 'textToImage', metadata: { workflowBudgetId: auth.budgetId, workflowRunId: 'run', workflowNodeId: nodeId } }); return { taskId: nodeId }; });
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); db = await createConnection(mongo.getUri()).asPromise();
    reservations = db.model(WorkflowBudgetTask.name, WorkflowBudgetTaskSchema); links = db.model(DramaWorkflowLink.name, DramaWorkflowLinkSchema); projects = db.model(ShortDramaProject.name, ShortDramaProjectSchema); runs = db.model(WorkflowRun.name, WorkflowRunSchema); models = db.model(ModelConfig.name, ModelConfigSchema); bills = db.model(BillingRecord.name, BillingRecordSchema); tasks = db.model(Task.name, TaskSchema);
    await reservations.init();
    service = new WorkflowBudgetService(reservations, links, projects, runs, models, bills, tasks, billing as any);
  }, 60000);
  beforeEach(async () => {
    await Promise.all(([reservations, links, projects, runs, models, bills, tasks] as Model<any>[]).map(model => model.deleteMany({})));
    billing.resolvePolicy.mockResolvedValue('internal'); delete process.env.DRAMA_GENERATION_ENABLED;
    await projects.create({ id: 'project', ownerId: 'owner', plan: templatePlan('letter-story-v1'), budgetLimit: 5 });
    await links.create({ id: 'link', ownerId: 'owner', projectId: 'project', shotId: 'shot', kind: 'image', sourceRevision: 0, inputFingerprint: 'fingerprint', workflowId: 'workflow' });
    await runs.create({ runId: 'run', workflowId: 'workflow', triggerId: 'owner', executionApiKey: 'isolated-key', parentTaskId: 'parent', workflowVersion: 0, status: 'running', nodeStates: ['a', 'b'].map(nodeId => ({ nodeId, status: 'running', attempt: 0 })) });
    await models.create({ model_id: 'fixture', model_name: 'Fixture', model_type: 'textToImage', provider: 'fixture', revision: 1, params: { prompt: { type: 'string', required: true } }, unit_price_map: { default: { unit_credit: 4 } } });
  });
  afterEach(() => { delete process.env.DRAMA_GENERATION_ENABLED; });
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  it('atomically shares the project limit across concurrent model nodes and pins the task cap', async () => {
    const a = create('a'), b = create('b'); const result = await Promise.allSettled([service.createTask(job('a'), a), service.createTask(job('b'), b)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(a.mock.calls.length + b.mock.calls.length).toBe(1); expect(await summary()).toMatchObject({ used: 0, reserved: 4, remaining: 1 });
    const call = a.mock.calls[0] || b.mock.calls[0]; expect(call[0]).toMatchObject({ maxCharge: 4, configRevision: 1, featureType: 'textToImage' });
  });
  it('does not create duplicate paid tasks and reconciles settlement/refund once', async () => {
    const a = create('a'); await service.createTask(job('a'), a); await service.createTask(job('a'), a); expect(a).toHaveBeenCalledTimes(1);
    await bills.create({ taskId: 'a', apiKey: 'isolated-key', model: 'fixture', provider: 'fixture', usageType: 'count', billingPolicy: 'internal', status: 'settled', actualCost: 3 });
    await service.reconcile('owner', 'project'); await service.reconcile('owner', 'project'); expect(await summary()).toMatchObject({ used: 3, reserved: 0, remaining: 2 });
    await projects.updateOne({ id: 'project' }, { $set: { budgetLimit: 8 } }); const b = create('b'); await service.createTask(job('b'), b);
    await bills.create({ taskId: 'b', apiKey: 'isolated-key', model: 'fixture', provider: 'fixture', usageType: 'count', billingPolicy: 'internal', status: 'refunded', actualCost: 0 });
    await service.reconcile('owner', 'project'); expect(await summary()).toMatchObject({ used: 3, reserved: 0, remaining: 5 });
  });
  it('retains uncertain submissions, recovers an existing task, and only releases definitive rejection', async () => {
    const unknown = jest.fn(async () => { throw new Error('Response lost'); }); await expect(service.createTask(job('a'), unknown)).rejects.toThrow('Response lost');
    await expect(service.createTask(job('a'), unknown)).rejects.toThrow('待核对'); expect(unknown).toHaveBeenCalledTimes(1); expect((await summary()).reserved).toBe(4);
    const reservation = await reservations.findOne({ nodeId: 'a' }).lean(); await tasks.create({ taskId: 'recovered', apiKey: 'isolated-key', model: 'fixture', provider: 'fixture', featureType: 'textToImage', metadata: { workflowBudgetId: reservation!.id, workflowRunId: 'run', workflowNodeId: 'a' } });
    expect((await service.createTask(job('a'), unknown)).taskId).toBe('recovered'); expect(unknown).toHaveBeenCalledTimes(1);
    await projects.updateOne({ id: 'project' }, { $set: { budgetLimit: 8 } }); await expect(service.createTask(job('b'), async () => { throw new BadRequestException('Invalid input'); })).rejects.toThrow('Invalid input'); expect((await summary()).reserved).toBe(4);
  });
  it('blocks paused, archived, cancelled and mismatched-key jobs before submitting a task', async () => {
    const a = create('a'); process.env.DRAMA_GENERATION_ENABLED = 'false'; await expect(service.createTask(job('a'), a)).rejects.toThrow('暂停'); delete process.env.DRAMA_GENERATION_ENABLED;
    await projects.updateOne({ id: 'project' }, { $set: { archived: true } }); await expect(service.createTask(job('a'), a)).rejects.toThrow('恢复');
    await projects.updateOne({ id: 'project' }, { $set: { archived: false } }); await expect(service.createTask({ ...job('a'), apiKey: 'foreign' }, a)).rejects.toThrow('节点已变化');
    await runs.updateOne({ runId: 'run' }, { $set: { status: 'cancelled' } }); await expect(service.createTask(job('a'), a)).rejects.toThrow('节点已变化'); expect(a).not.toHaveBeenCalled();
  });
});
