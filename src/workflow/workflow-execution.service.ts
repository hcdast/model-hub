import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bull';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkflowRun,
  WorkflowRunDocument,
  NodeExecutionState,
} from '../database/schemas/workflow-run.schema';
import {
  Workflow,
  WorkflowDocument,
  WorkflowEdge,
} from '../database/schemas/workflow.schema';
import { ExecutionGraphResolver } from './execution-graph.resolver';
import type { NodeExecutionJob } from './node.executor';
import { PortalApiKeyService } from '../portal-auth/portal-api-key.service';
import { TaskService } from '../task/task.service';
import { WorkflowPolicyService } from './workflow-policy.service';

const TERMINAL_NODE_STATES: Record<string, true> = {
  succeeded: true,
  failed: true,
  skipped: true,
  cancelled: true,
};

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name);

  constructor(
    @InjectModel(WorkflowRun.name)
    private readonly runModel: Model<WorkflowRunDocument>,
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
    @InjectQueue('workflow-node')
    private readonly workflowQueue: Queue<NodeExecutionJob>,
    private readonly graphResolver: ExecutionGraphResolver,
    private readonly eventEmitter: EventEmitter2,
    private readonly portalApiKeyService: PortalApiKeyService,
    private readonly taskService: TaskService,
    private readonly workflowPolicy: WorkflowPolicyService,
  ) {}
  async run(
    workflowId: string,
    input: Record<string, unknown>,
    clientId: string,
    nodeIds?: string[],
    presentedApiKey?: string,
  ): Promise<{ runId: string; status: string; nodeId?: string }> {
    const workflow = await this.workflowModel.findOne({
      _id: workflowId,
      creatorId: clientId,
    });
    if (!workflow) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow not found',
      });
    }

    const validation = this.graphResolver.validate(workflow);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'WORKFLOW_INVALID_GRAPH',
        message: 'Workflow validation failed',
        errors: validation.errors,
      });
    }

    const targetNodeIds = this.resolveTargetNodeIds(workflow, nodeIds);
    const targetNodes = workflow.nodes.filter((node) => targetNodeIds.has(node.id));
    await this.workflowPolicy.assertNodesAllowed(clientId, targetNodes);
    const requiresModelExecution = targetNodes.some((node) =>
      Boolean(node.data?.modelId),
    );
    let executionApiKey = presentedApiKey;
    if (requiresModelExecution && !executionApiKey) {
      executionApiKey =
        (await this.portalApiKeyService.findExecutionBillingKey(clientId)) ??
        undefined;
    }
    if (requiresModelExecution && !executionApiKey) {
      throw new BadRequestException({
        code: 'WORKFLOW_API_KEY_REQUIRED',
        message: 'Create an enabled Portal API Key before running model nodes',
      });
    }

    const runId = uuidv4();
    const lease = await this.workflowPolicy.acquireRun(clientId, runId);
    const configuredTimeout = Math.max(
      1,
      workflow.executionConfig?.timeout ?? lease.timeoutSeconds,
    );
    const executionTimeoutSeconds = lease.acquired
      ? Math.min(configuredTimeout, lease.timeoutSeconds)
      : configuredTimeout;
    const run = new this.runModel({
      runId,
      workflowId,
      workflowVersion: workflow.__v ?? 0,
      triggerId: clientId,
      executionApiKey,
      executionTimeoutSeconds,
      parentTaskId: `workflow-${runId}`,
      status: 'running',
      startedAt: new Date(),
      input,
      nodeStates: workflow.nodes.map((node) => ({
        nodeId: node.id,
        status: targetNodeIds.has(node.id) ? 'pending' : 'skipped',
        retryCount: 0,
        attempt: 0,
      })),
      stats: {
        totalNodes: targetNodeIds.size,
        completedNodes: 0,
        failedNodes: 0,
        skippedNodes: workflow.nodes.length - targetNodeIds.size,
        totalDuration: 0,
        estimatedCost: 0,
      },
    });
    try {
      await run.save();
      this.eventEmitter.emit('workflow.run.started', {
        runId,
        workflowId,
        clientId,
        nodeIds: [...targetNodeIds],
      });
      this.emitRunEvent(runId, { status: 'running' });
      await this.scheduleReadyNodes(runId, workflow);
    } catch (error) {
      await this.runModel.deleteOne({ runId });
      await this.workflowPolicy.releaseRun(clientId, runId);
      throw error;
    }
    const current = await this.runModel.findOne({ runId }).select('status').lean();
    return { runId, status: current?.status ?? 'running' };
  }

  async runNode(
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
    clientId: string,
    presentedApiKey?: string,
  ): Promise<{ runId: string; status: string; nodeId: string }> {
    const result = await this.run(
      workflowId,
      input,
      clientId,
      [nodeId],
      presentedApiKey,
    );
    return { ...result, nodeId };
  }

  async cancel(runId: string, clientId: string): Promise<void> {
    const completedAt = new Date();
    const run = await this.runModel.findOneAndUpdate(
      {
        runId,
        triggerId: clientId,
        status: { $in: ['running', 'pending'] },
      },
      {
        $set: {
          status: 'cancelled',
          completedAt,
          'nodeStates.$[active].status': 'cancelled',
          'nodeStates.$[active].completedAt': completedAt,
        },
      },
      {
        new: true,
        arrayFilters: [{ 'active.status': { $in: ['pending', 'running'] } }],
      },
    );
    if (!run) {
      const existing = await this.runModel
        .findOne({ runId, triggerId: clientId })
        .select('status')
        .lean();
      if (!existing) throw new NotFoundException('Run not found');
      throw new ConflictException(`Run cannot be cancelled from ${existing.status}`);
    }
    this.recalculateStats(run);
    await this.runModel.updateOne(
      { _id: run._id, status: 'cancelled' },
      { $set: { stats: run.stats } },
    );

    const jobsToRemove = run.nodeStates
      .map((state) => state.jobId)
      .filter((jobId): jobId is string => Boolean(jobId));
    const tasksToCancel = run.nodeStates
      .map((state) => state.taskId)
      .filter((taskId): taskId is string => Boolean(taskId));

    await Promise.all(
      jobsToRemove.map(async (jobId) => {
        try {
          const job = await this.workflowQueue.getJob(jobId);
          if (job) await job.remove();
        } catch (error) {
          this.logger.warn(
            `Unable to remove workflow job ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
    const executionApiKey = run.executionApiKey;
    if (executionApiKey) {
      await Promise.all(
        tasksToCancel.map(async (taskId) => {
          try {
            await this.taskService.cancelTask(
              executionApiKey,
              taskId,
              `workflow:${runId}`,
            );
          } catch (error) {
            this.logger.warn(
              `Unable to cancel child task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }

    await this.workflowPolicy.releaseRun(clientId, runId);
    this.eventEmitter.emit('workflow.run.cancelled', { runId });
    this.emitRunEvent(runId, { status: 'cancelled' });
  }

  async retry(runId: string, clientId: string, nodeIds?: string[]): Promise<void> {
    const run = await this.runModel.findOne({ runId, triggerId: clientId });
    if (!run) throw new NotFoundException('Run not found');
    if (run.status !== 'failed') {
      throw new ConflictException(`Run cannot be retried from ${run.status}`);
    }

    const requested = nodeIds ? new Set(nodeIds) : null;
    const retryable = run.nodeStates.filter(
      (state) =>
        state.status === 'failed' && (!requested || requested.has(state.nodeId)),
    );
    if (retryable.length === 0) {
      throw new ConflictException('No failed nodes are available for retry');
    }

    const workflow = await this.workflowModel.findById(run.workflowId);
    if (!workflow) throw new NotFoundException('Workflow not found');
    const retryNodeIds = new Set(retryable.map((state) => state.nodeId));
    await this.workflowPolicy.assertNodesAllowed(
      clientId,
      workflow.nodes.filter((node) => retryNodeIds.has(node.id)),
    );
    const lease = await this.workflowPolicy.acquireRun(clientId, runId);
    const claimed = await this.runModel.updateOne(
      { _id: run._id, status: 'failed' },
      { $set: { status: 'running' }, $unset: { error: 1, completedAt: 1 } },
    );
    if (claimed.modifiedCount !== 1) {
      await this.workflowPolicy.releaseRun(clientId, runId);
      const current = await this.runModel
        .findById(run._id)
        .select('status')
        .lean();
      throw new ConflictException(
        `Run cannot be retried from ${current?.status ?? 'unknown'}`,
      );
    }

    try {
      for (const state of retryable) {
        state.status = 'pending';
        state.retryCount += 1;
        state.attempt = (state.attempt ?? 0) + 1;
        state.error = undefined;
        state.output = undefined;
        state.taskId = undefined;
        state.jobId = undefined;
        state.startedAt = undefined;
        state.completedAt = undefined;
      }
      const downstreamIds = new Set(retryable.map((state) => state.nodeId));
      let addedDownstream = true;
      while (addedDownstream) {
        addedDownstream = false;
        for (const edge of workflow.edges) {
          if (
            downstreamIds.has(edge.source.nodeId) &&
            !downstreamIds.has(edge.target.nodeId)
          ) {
            downstreamIds.add(edge.target.nodeId);
            addedDownstream = true;
          }
        }
      }
      for (const state of run.nodeStates) {
        if (state.status !== 'skipped' || !downstreamIds.has(state.nodeId)) {
          continue;
        }
        state.status = 'pending';
        state.error = undefined;
        state.output = undefined;
        state.taskId = undefined;
        state.jobId = undefined;
        state.startedAt = undefined;
        state.completedAt = undefined;
      }
      run.status = 'running';
      run.error = undefined;
      run.completedAt = undefined;
      if (lease.acquired) {
        run.executionTimeoutSeconds = Math.min(
          run.executionTimeoutSeconds,
          lease.timeoutSeconds,
        );
      }
      this.recalculateStats(run);
      await run.save();
      await this.scheduleReadyNodes(runId, workflow);
    } catch (error) {
      await this.runModel.updateOne(
        { _id: run._id, status: 'running' },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            error: {
              code: 'WORKFLOW_RETRY_FAILED',
              message: error instanceof Error ? error.message : String(error),
            },
          },
        },
      );
      await this.workflowPolicy.releaseRun(clientId, runId);
      throw error;
    }
    this.eventEmitter.emit('workflow.run.retry', {
      runId,
      nodeIds: retryable.map((state) => state.nodeId),
    });
    this.emitRunEvent(runId, { status: 'running' });
  }

  async onNodeTaskCreated(
    runId: string,
    nodeId: string,
    taskId: string,
  ): Promise<void> {
    const claimed = await this.runModel.updateOne(
      {
        runId,
        status: 'running',
        nodeStates: { $elemMatch: { nodeId, status: 'running' } },
      },
      { $set: { 'nodeStates.$.taskId': taskId } },
    );
    if (claimed.modifiedCount === 1) return;

    const run = await this.runModel.findOne({ runId });
    if (run?.status === 'cancelled' && run.executionApiKey) {
      try {
        await this.taskService.cancelTask(
          run.executionApiKey,
          taskId,
          `workflow:${runId}`,
        );
      } catch (error) {
        this.logger.warn(
          `取消竞态中的模型任务失败: runId=${runId}, taskId=${taskId}, error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async onNodeComplete(
    runId: string,
    nodeId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    const completedAt = new Date();
    const claimed = await this.runModel.updateOne(
      {
        runId,
        status: 'running',
        nodeStates: { $elemMatch: { nodeId, status: 'running' } },
      },
      {
        $set: {
          'nodeStates.$.status': 'succeeded',
          'nodeStates.$.output': output,
          'nodeStates.$.completedAt': completedAt,
        },
      },
    );
    if (claimed.modifiedCount !== 1) return;

    const run = await this.runModel.findOne({ runId });
    if (!run) return;
    const allCompleted = run.nodeStates.every(
      (item) => item.status === 'succeeded' || item.status === 'skipped',
    );
    if (allCompleted) run.completedAt = completedAt;
    this.recalculateStats(run);
    const finalized = allCompleted
      ? await this.runModel.findOneAndUpdate(
          {
            _id: run._id,
            status: 'running',
            nodeStates: {
              $not: {
                $elemMatch: {
                  status: { $nin: ['succeeded', 'skipped'] },
                },
              },
            },
          },
          {
            $set: {
              status: 'succeeded',
              completedAt,
              stats: run.stats,
            },
          },
          { new: true },
        )
      : null;
    if (!allCompleted) {
      await this.runModel.updateOne(
        { _id: run._id, status: 'running' },
        { $set: { stats: run.stats } },
      );
    }

    this.eventEmitter.emit('workflow.node.completed', { runId, nodeId, output });
    this.emitRunEvent(runId, { nodeId, status: 'succeeded', output });
    if (finalized) {
      await this.workflowPolicy.releaseRun(finalized.triggerId, runId);
      this.eventEmitter.emit('workflow.run.completed', { runId });
      this.emitRunEvent(runId, { status: 'succeeded' });
      return;
    }

    const workflow = await this.workflowModel.findById(run.workflowId);
    if (workflow) await this.scheduleReadyNodes(runId, workflow);
  }

  async onNodeFailed(
    runId: string,
    nodeId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    const completedAt = new Date();
    const claimed = await this.runModel.updateOne(
      {
        runId,
        status: 'running',
        nodeStates: { $elemMatch: { nodeId, status: 'running' } },
      },
      {
        $set: {
          'nodeStates.$.status': 'failed',
          'nodeStates.$.error': error,
          'nodeStates.$.completedAt': completedAt,
          error: { ...error, nodeId },
        },
      },
    );
    if (claimed.modifiedCount !== 1) return;

    let run = await this.runModel.findOne({ runId });
    if (!run) return;
    const workflow = await this.workflowModel.findById(run.workflowId);
    const continueOnFailure =
      workflow?.executionConfig?.failureStrategy === 'continue';
    let finalized = false;
    if (!continueOnFailure || !workflow) {
      run = await this.runModel.findOne({ runId });
      if (!run) return;
      run.completedAt = completedAt;
      this.recalculateStats(run);
      const result = await this.runModel.updateOne(
        { _id: run._id, status: 'running' },
        {
          $set: {
            status: 'failed',
            completedAt,
            stats: run.stats,
          },
        },
      );
      finalized = result.modifiedCount === 1;
    } else {
      this.recalculateStats(run);
      await this.runModel.updateOne(
        { _id: run._id, status: 'running' },
        { $set: { stats: run.stats } },
      );
    }

    this.eventEmitter.emit('workflow.node.failed', { runId, nodeId, error });
    this.emitRunEvent(runId, { nodeId, status: 'failed', error });
    if (finalized) {
      await this.workflowPolicy.releaseRun(run.triggerId, runId);
      this.eventEmitter.emit('workflow.run.failed', { runId, error });
      this.emitRunEvent(runId, { status: 'failed', error });
      return;
    }
    if (continueOnFailure && workflow) {
      await this.scheduleReadyNodes(runId, workflow);
    }
  }

  async getStatus(
    runId: string,
    clientId: string,
  ): Promise<WorkflowRunDocument | null> {
    return this.runModel.findOne({ runId, triggerId: clientId });
  }

  async listRuns(query: {
    workflowId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: WorkflowRunDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const filter: Record<string, string> = {};
    if (query.workflowId) filter.workflowId = query.workflowId;
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.runModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      this.runModel.countDocuments(filter),
    ]);
    return { items, total, page, pageSize };
  }

  private resolveTargetNodeIds(
    workflow: WorkflowDocument,
    requestedNodeIds?: string[],
  ): Set<string> {
    if (!requestedNodeIds?.length) {
      return new Set(workflow.nodes.map((node) => node.id));
    }

    const knownIds = new Set(workflow.nodes.map((node) => node.id));
    for (const nodeId of requestedNodeIds) {
      if (!knownIds.has(nodeId)) {
        throw new NotFoundException(`Node not found: ${nodeId}`);
      }
    }

    const selected = new Set(requestedNodeIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of workflow.edges) {
        if (selected.has(edge.target.nodeId) && !selected.has(edge.source.nodeId)) {
          selected.add(edge.source.nodeId);
          changed = true;
        }
      }
    }
    return selected;
  }

  private async scheduleReadyNodes(
    runId: string,
    workflow: WorkflowDocument,
  ): Promise<void> {
    let run = await this.runModel.findOne({ runId });
    if (!run || run.status !== 'running') return;

    let skippedAny = true;
    while (skippedAny) {
      const skipNodeIds: string[] = [];
      for (const state of run.nodeStates) {
        if (state.status !== 'pending') continue;
        const incoming = this.getSelectedIncomingEdges(
          workflow,
          run.nodeStates,
          state.nodeId,
        );
        const activeIncoming = incoming.filter((edge) =>
          this.isActiveBranchEdge(edge, run!.nodeStates),
        );
        const hasInactiveBranch =
          incoming.length > 0 &&
          activeIncoming.length === 0 &&
          incoming.every((edge) => {
            const source = run!.nodeStates.find(
              (item) => item.nodeId === edge.source.nodeId,
            );
            return source ? Boolean(TERMINAL_NODE_STATES[source.status]) : true;
          });
        const hasFailedDependency = activeIncoming.some((edge) => {
          const source = run!.nodeStates.find(
            (item) => item.nodeId === edge.source.nodeId,
          );
          return source?.status === 'failed' || source?.status === 'cancelled';
        });
        if (hasInactiveBranch || hasFailedDependency) {
          skipNodeIds.push(state.nodeId);
        }
      }
      const skipResults = await Promise.all(
        skipNodeIds.map((nodeId) =>
          this.runModel.updateOne(
            {
              runId,
              status: 'running',
              nodeStates: { $elemMatch: { nodeId, status: 'pending' } },
            },
            {
              $set: {
                'nodeStates.$.status': 'skipped',
                'nodeStates.$.completedAt': new Date(),
              },
            },
          ),
        ),
      );
      skippedAny = skipResults.some((result) => result.modifiedCount === 1);
      if (skippedAny) {
        run = await this.runModel.findOne({ runId });
        if (!run || run.status !== 'running') return;
      }
    }

    if (
      run.nodeStates.every((state) =>
        Boolean(TERMINAL_NODE_STATES[state.status]),
      )
    ) {
      const hasFailures = run.nodeStates.some(
        (state) => state.status === 'failed',
      );
      const completedAt = new Date();
      run.completedAt = completedAt;
      this.recalculateStats(run);
      const finalized = await this.runModel.findOneAndUpdate(
        {
          _id: run._id,
          status: 'running',
          nodeStates: {
            $not: {
              $elemMatch: {
                status: {
                  $nin: ['succeeded', 'failed', 'skipped', 'cancelled'],
                },
              },
            },
          },
        },
        {
          $set: {
            status: hasFailures ? 'failed' : 'succeeded',
            completedAt,
            stats: run.stats,
          },
        },
        { new: true },
      );
      if (!finalized) return;
      await this.workflowPolicy.releaseRun(finalized.triggerId, runId);
      if (hasFailures) {
        this.eventEmitter.emit('workflow.run.failed', { runId, error: finalized.error });
        this.emitRunEvent(runId, { status: 'failed', error: finalized.error });
      } else {
        this.eventEmitter.emit('workflow.run.completed', { runId });
        this.emitRunEvent(runId, { status: 'succeeded' });
      }
      return;
    }

    const maxParallelism = Math.max(
      1,
      workflow.executionConfig?.maxParallelism ?? 5,
    );
    let availableSlots =
      maxParallelism -
      run.nodeStates.filter((state) => state.status === 'running').length;
    if (availableSlots <= 0) return;

    const pending = run.nodeStates.filter((state) => state.status === 'pending');
    for (const state of pending) {
      if (availableSlots <= 0) break;
      const incoming = this.getSelectedIncomingEdges(workflow, run.nodeStates, state.nodeId)
        .filter((edge) => this.isActiveBranchEdge(edge, run!.nodeStates));
      const ready = incoming.every((edge) => {
        const source = run!.nodeStates.find(
          (item) => item.nodeId === edge.source.nodeId,
        );
        return source?.status === 'succeeded';
      });
      if (
        ready &&
        (await this.enqueueNode(run, workflow, state.nodeId, incoming))
      ) {
        availableSlots -= 1;
      }
    }
  }

  private async enqueueNode(
    run: WorkflowRunDocument,
    workflow: WorkflowDocument,
    nodeId: string,
    incoming: WorkflowEdge[],
  ): Promise<boolean> {
    const node = workflow.nodes.find((item) => item.id === nodeId);
    const state = run.nodeStates.find((item) => item.nodeId === nodeId);
    if (!node || !state) return false;

    const input: Record<string, unknown> = {};
    const nodeOutputs: Record<string, Record<string, unknown>> = {};
    for (const sourceState of run.nodeStates) {
      if (sourceState.output) {
        nodeOutputs[sourceState.nodeId] = sourceState.output;
      }
    }
    for (const edge of incoming) {
      const sourceOutput = nodeOutputs[edge.source.nodeId];
      input[edge.target.port] =
        sourceOutput?.[edge.source.port] ?? sourceOutput;
    }

    const attempt = state.attempt ?? state.retryCount ?? 0;
    const safeNodeId = Buffer.from(nodeId).toString('base64url');
    const jobId = `workflow-${run.runId}-${safeNodeId}-${attempt}`;
    const claimed = await this.runModel.updateOne(
      {
        runId: run.runId,
        status: 'running',
        nodeStates: { $elemMatch: { nodeId, status: 'pending' } },
      },
      {
        $set: {
          'nodeStates.$.status': 'running',
          'nodeStates.$.startedAt': new Date(),
          'nodeStates.$.input': input,
          'nodeStates.$.jobId': jobId,
        },
      },
    );
    if (claimed.modifiedCount !== 1) return false;

    const jobData: NodeExecutionJob = {
      runId: run.runId,
      nodeId,
      nodeType: node.type,
      nodeData: node.data ?? {},
      input,
      apiKey: run.executionApiKey,
      attempt,
      timeoutMs: run.executionTimeoutSeconds * 1000,
      context: {
        input: run.input ?? {},
        nodeOutputs,
      },
    };

    try {
      await this.workflowQueue.add(jobData, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      this.eventEmitter.emit('workflow.node.running', { runId: run.runId, nodeId });
      this.emitRunEvent(run.runId, { nodeId, status: 'running' });
      return true;
    } catch (error) {
      await this.onNodeFailed(run.runId, nodeId, {
        code: 'NODE_QUEUE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private getSelectedIncomingEdges(
    workflow: WorkflowDocument,
    states: NodeExecutionState[],
    nodeId: string,
  ): WorkflowEdge[] {
    const selectedIds = new Set(
      states
        .filter((state) => state.status !== 'skipped')
        .map((state) => state.nodeId),
    );
    return workflow.edges.filter(
      (edge) =>
        edge.target.nodeId === nodeId && selectedIds.has(edge.source.nodeId),
    );
  }

  private isActiveBranchEdge(
    edge: WorkflowEdge,
    states: NodeExecutionState[],
  ): boolean {
    if (!edge.branchId) return true;
    const source = states.find((state) => state.nodeId === edge.source.nodeId);
    return source?.output?.branchId === edge.branchId;
  }

  private recalculateStats(run: WorkflowRunDocument): void {
    const now = run.completedAt?.getTime() ?? Date.now();
    const started = run.startedAt?.getTime() ?? now;
    run.stats = {
      totalNodes: run.nodeStates.filter((state) => state.status !== 'skipped').length,
      completedNodes: run.nodeStates.filter((state) => state.status === 'succeeded').length,
      failedNodes: run.nodeStates.filter((state) => state.status === 'failed').length,
      skippedNodes: run.nodeStates.filter((state) => state.status === 'skipped').length,
      totalDuration: Math.max(0, now - started),
      estimatedCost: run.stats?.estimatedCost ?? 0,
    };
  }

  private emitRunEvent(
    runId: string,
    event: {
      nodeId?: string;
      status: string;
      output?: Record<string, unknown>;
      error?: { code: string; message: string };
    },
  ): void {
    this.eventEmitter.emit(`workflow.run.${runId}`, { runId, ...event });
  }
}
