import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { WorkflowBudgetTask } from './workflow-budget.schema';
import { DramaWorkflowLink } from './drama-workflow.schema';
import { ShortDramaProject } from '../short-drama/drama.schema';
import { WorkflowRun } from '../database/schemas/workflow-run.schema';
import { ModelConfig } from '../database/schemas/model-config.schema';
import { BillingRecord } from '../database/schemas/billing-record.schema';
import { Task } from '../database/schemas/task.schema';
import { BillingAdapter } from '../billing/billing.adapter';
import { findExplicitModelConfig, findModelConfigForTask } from '../task/model-config-resolver.util';
import { validateParams } from '../common/utils/param-validator';
import { estimateModelPrice } from '../common/utils/model-pricing';
import type { NodeExecutionJob } from '../workflow/node.executor';

export interface WorkflowTaskAuthorization { maxCharge: number; budgetId: string; input: Record<string, unknown>; configId: string; configRevision: number; featureType: string }
@Injectable()
export class WorkflowBudgetService {
  constructor(
    @InjectModel(WorkflowBudgetTask.name) private readonly reservations: Model<WorkflowBudgetTask>,
    @InjectModel(DramaWorkflowLink.name) private readonly links: Model<DramaWorkflowLink>,
    @InjectModel(ShortDramaProject.name) private readonly projects: Model<ShortDramaProject>,
    @InjectModel(WorkflowRun.name) private readonly runs: Model<WorkflowRun>,
    @InjectModel(ModelConfig.name) private readonly models: Model<ModelConfig>,
    @InjectModel(BillingRecord.name) private readonly bills: Model<BillingRecord>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    private readonly billing: BillingAdapter,
  ) {}

  async assertRunnable(workflowId: string, ownerId: string) {
    const link = await this.links.findOne({ workflowId, ownerId }).lean();
    if (!link) return;
    if (process.env.DRAMA_GENERATION_ENABLED === 'false') throw new ServiceUnavailableException('短剧新生成暂时暂停');
    const project = await this.projects.findOne({ id: link.projectId, ownerId }).lean();
    if (!project) throw new NotFoundException('原短剧项目不存在');
    if (project.archived) throw new BadRequestException('请先恢复原短剧项目再运行高级流程');
  }

  async createTask(job: NodeExecutionJob, create: (authorization?: WorkflowTaskAuthorization) => Promise<{ taskId: string }>): Promise<{ taskId: string }> {
    const run = await this.runs.findOne({ runId: job.runId }).select('+executionApiKey').lean();
    if (!run) throw new NotFoundException('运行不存在');
    const link = await this.links.findOne({ workflowId: run.workflowId, ownerId: run.triggerId }).lean();
    if (!link) return create();
    await this.assertRunnable(run.workflowId, run.triggerId);
    const state = run.nodeStates.find(n => n.nodeId === job.nodeId);
    if (run.status !== 'running' || state?.status !== 'running' || (state.attempt || 0) !== (job.attempt || 0) || run.executionApiKey !== job.apiKey) throw new ConflictException('节点已变化，拒绝提交新的模型任务');
    await this.reconcile(run.triggerId, link.projectId);
    const parameters = { ...job.nodeData.parameters, ...job.input };
    const selection = job.nodeData.modelSelection;
    const cfg = selection?.configId
      ? await findExplicitModelConfig(this.models as any, job.nodeData.modelId!, selection, selection.featureType)
      : await findModelConfigForTask(this.models as any, job.nodeData.modelId!);
    if (!cfg || cfg.disabled) throw new BadRequestException('请为高级流程选择启用的模型配置');
    const configId = String((cfg as ModelConfig & { _id: unknown })._id);
    const validation = validateParams(parameters, cfg.params || {}, cfg.params_rules);
    if (!validation.valid) throw new BadRequestException('高级流程参数检查失败，请补齐模型必填参数');
    const exempt = await this.billing.resolvePolicy(job.apiKey!) === 'exempt';
    const estimate = exempt ? 0 : estimateModelPrice(cfg, validation.sanitized).estimatedCost;
    if (!Number.isFinite(estimate) || estimate < 0 || !exempt && estimate === 0) throw new BadRequestException('模型未配置有效积分价格');
    const amount = Math.ceil(estimate * 1e6) / 1e6;
    const id = 'workflow-' + createHash('sha256').update(JSON.stringify([job.runId, job.nodeId, job.attempt || 0])).digest('hex');
    const inputHash = createHash('sha256').update(JSON.stringify([configId, cfg.revision || 0, validation.sanitized])).digest('hex');
    try { await this.reservations.updateOne({ id }, { $setOnInsert: { id, ownerId: run.triggerId, projectId: link.projectId, runId: run.runId, nodeId: job.nodeId, attempt: job.attempt || 0, amount, inputHash, state: 'ready' } }, { upsert: true }); }
    catch (error) { if ((error as any).code !== 11000) throw error; }
    const reservation = (await this.reservations.findOne({ id }).lean())!;
    if (reservation.inputHash !== inputHash) throw new ConflictException('同次节点提交的参数或价格已变化，请重新运行');
    if (reservation.taskId) return { taskId: reservation.taskId };
    const reserved = await this.projects.updateOne({ id: link.projectId, ownerId: run.triggerId, archived: { $ne: true }, 'budgetHolds.quoteId': { $ne: id },
      $expr: { $lte: [{ $add: [{ $sum: { $ifNull: ['$budgetHolds.amount', []] } }, amount] }, { $ifNull: ['$budgetLimit', 0] }] } },
      { $push: { budgetHolds: { quoteId: id, amount, settled: false } } });
    if (!reserved.modifiedCount && !(await this.projects.exists({ id: link.projectId, ownerId: run.triggerId, 'budgetHolds.quoteId': id }))) throw new BadRequestException('短剧项目剩余预算不足，请调整项目预算或减少高级流程范围');
    const claimed = await this.reservations.updateOne({ id, state: 'ready' }, { $set: { state: 'submitting' } });
    if (!claimed.modifiedCount) {
      const recovered = await this.reconcileOne(reservation);
      if (recovered) return { taskId: recovered };
      throw new ConflictException('模型提交正在处理或结果待核对，已保留预算以避免重复扣费');
    }
    try {
      await this.assertRunnable(run.workflowId, run.triggerId);
      const task = await create({ maxCharge: amount, budgetId: id, input: validation.sanitized, configId, configRevision: cfg.revision || 0, featureType: cfg.model_type });
      await this.reservations.updateOne({ id }, { $set: { taskId: task.taskId, state: 'bound' } });
      return task;
    } catch (error) {
      // Only definitive pre-submission rejections release the hold. Timeouts and unknown outcomes retain it.
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if ([400, 402, 404].includes(status || 0)) await this.finish(reservation, 0);
      throw error;
    }
  }

  async reconcile(ownerId: string, projectId: string) {
    const reservations = await this.reservations.find({ ownerId, projectId, state: { $in: ['submitting', 'bound'] } }).sort({ createdAt: 1 }).limit(100).lean();
    for (const reservation of reservations) await this.reconcileOne(reservation);
  }
  private async reconcileOne(reservation: WorkflowBudgetTask): Promise<string | undefined> {
    const run = await this.runs.findOne({ runId: reservation.runId, triggerId: reservation.ownerId }).select('+executionApiKey').lean();
    if (!run?.executionApiKey) return;
    const task = await this.tasks.findOne({ apiKey: run.executionApiKey, ...(reservation.taskId ? { taskId: reservation.taskId } : { 'metadata.workflowBudgetId': reservation.id, 'metadata.workflowRunId': reservation.runId, 'metadata.workflowNodeId': reservation.nodeId }) }).select('taskId status').lean();
    if (!task) return;
    await this.reservations.updateOne({ id: reservation.id, taskId: { $exists: false } }, { $set: { taskId: task.taskId, state: 'bound' } });
    const bill = await this.bills.findOne({ taskId: task.taskId, apiKey: run.executionApiKey }).select('status actualCost').lean();
    if (bill?.status === 'refunded') await this.finish(reservation, 0);
    else if (bill?.status === 'settled' && Number.isFinite(bill.actualCost) && bill.actualCost >= 0 && bill.actualCost <= reservation.amount) await this.finish(reservation, Math.round(bill.actualCost * 1e6) / 1e6);
    else if (!bill && ['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(task.status) && await this.billing.resolvePolicy(run.executionApiKey) === 'exempt') await this.finish(reservation, 0);
    return task.taskId;
  }
  private async finish(reservation: WorkflowBudgetTask, amount: number) {
    await this.projects.updateOne({ id: reservation.projectId, ownerId: reservation.ownerId, budgetHolds: { $elemMatch: { quoteId: reservation.id, settled: false } } }, { $set: { 'budgetHolds.$.amount': amount, 'budgetHolds.$.settled': true } });
    await this.reservations.updateOne({ id: reservation.id }, { $set: { state: 'settled' } });
  }
}
