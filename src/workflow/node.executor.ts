/*
 * 节点执行器
 * 负责执行工作流中的各类节点
 */
import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowNode } from '../database/schemas/workflow.schema';
import { SafeExpressionService } from './safe-expression.service';
import { TaskService } from '../task/task.service';
import { TaskStatus } from '../common/constants/task-status';
import { setTimeout as delay } from 'timers/promises';

/**
 * 节点执行任务数据
 */
export interface NodeExecutionJob {
  /** 非敏感任务归属 Key */
  apiKey?: string;
  /** 当前重试 attempt */
  attempt?: number;
  /** 节点超时 */
  timeoutMs?: number;
  /** 执行实例 ID */
  runId: string;
  /** 节点 ID */
  nodeId: string;
  /** 节点类型 */
  nodeType: WorkflowNode['type'];
  /** 节点数据 */
  nodeData: WorkflowNode['data'];
  /** 输入数据 */
  input: Record<string, any>;
  /** 工作流上下文 */
  context: {
    /** 工作流输入 */
    input: Record<string, any>;
    /** 已完成节点的输出 */
    nodeOutputs: Record<string, Record<string, any>>;
  };
}

/**
 * 节点执行器
 * 作为 Bull 队列消费者处理工作流节点执行任务
 */
@Processor('workflow-node')
export class NodeExecutor {
  private readonly logger = new Logger(NodeExecutor.name);

  constructor(
    private readonly executionService: WorkflowExecutionService,
    private readonly safeExpression: SafeExpressionService,
    private readonly taskService: TaskService,
  ) {}

  /**
   * 处理节点执行任务
   */
  @Process()
  async execute(job: Job<NodeExecutionJob>): Promise<void> {
    const { runId, nodeId, nodeType, nodeData, input, context } = job.data;

    this.logger.log(`执行节点: runId=${runId}, nodeId=${nodeId}, type=${nodeType}`);

    try {
      let output: unknown;

      switch (nodeType) {
        case 'model':
        case 'ai-chat':
        case 'script-writer':
        case 'storyboard':
        case 'text-to-image':
        case 'image-to-image':
        case 'image-editor':
        case 'image-upscale':
        case 'text-to-video':
        case 'image-to-video':
        case 'video-to-video':
        case 'video-upscale':
        case 'character-create':
        case 'face-swap':
        case 'character-swap':
        case 'text-to-speech':
        case 'music-generation':
          output = await this.executeModelNode(job.data);
          break;
        case 'condition':
          output = await this.executeConditionNode(nodeId, nodeData, input, context);
          break;
        case 'loop':
          output = await this.executeLoopNode(nodeId, nodeData, input, context);
          break;
        case 'transform':
          output = await this.executeTransformNode(nodeId, nodeData, input, context);
          break;
        case 'input':
          output = context.input;
          break;
        case 'output':
          output = input;
          break;
        default:
          throw new Error(`不支持的节点类型: ${nodeType}`);
      }

      const nodeOutput =
        output !== null && typeof output === 'object' && !Array.isArray(output)
          ? output as Record<string, unknown>
          : { value: output };
      await this.executionService.onNodeComplete(runId, nodeId, nodeOutput);
      this.logger.log(`节点执行成功: runId=${runId}, nodeId=${nodeId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown node error';
      this.logger.error(`节点执行失败: runId=${runId}, nodeId=${nodeId}, error=${message}`);
      await this.executionService.onNodeFailed(runId, nodeId, {
        code: 'NODE_EXECUTION_FAILED',
        message,
      });
    }
  }

  /**
   * 执行模型节点并等待现有 TaskService 任务进入终态。
   */
  private async executeModelNode(job: NodeExecutionJob): Promise<unknown> {
    const { runId, nodeId, nodeData, input, apiKey } = job;
    const modelId = nodeData.modelId;
    if (!modelId) {
      throw new Error('模型节点缺少 modelId');
    }
    if (!apiKey) {
      throw new Error('模型节点执行需要可计费的 API Key');
    }

    const params = {
      ...nodeData.parameters,
      ...input,
    };
    const task = await this.taskService.createTask(
      apiKey,
      {
        model: modelId,
        input: params,
        metadata: {
          workflowRunId: runId,
          workflowNodeId: nodeId,
        },
      },
      `workflow:${runId}:${nodeId}:${job.attempt ?? 0}`,
    );
    await this.executionService.onNodeTaskCreated(runId, nodeId, task.taskId);

    const deadline = Date.now() + (job.timeoutMs ?? 5 * 60 * 1000);
    while (Date.now() < deadline) {
      const current = await this.taskService.getTask(apiKey, task.taskId);
      if (current.status === TaskStatus.SUCCESS) {
        return {
          taskId: current.taskId,
          result: current.result,
        };
      }
      if (
        current.status === TaskStatus.FAILED ||
        current.status === TaskStatus.TIMEOUT ||
        current.status === TaskStatus.CANCELLED
      ) {
        throw new Error(
          current.error?.message || `模型任务结束于状态 ${current.status}`,
        );
      }
      await delay(1000);
    }
    throw new Error(`模型任务执行超时: ${task.taskId}`);
  }

  /**
   * 执行条件节点
   */
  private async executeConditionNode(
    nodeId: string,
    nodeData: WorkflowNode['data'],
    input: Record<string, unknown>,
    context: NodeExecutionJob['context'],
  ): Promise<{ branchId: string }> {
    const conditions = nodeData.conditions || [];

    this.logger.debug(`评估条件: nodeId=${nodeId}, conditions=${conditions.length}`);

    // 构建表达式上下文
    const expressionContext = {
      $input: input,
      $workflow: context.input,
      $nodes: context.nodeOutputs,
    };

    // 按顺序评估条件
    for (const condition of conditions) {
      const result = this.safeExpression.evaluate(
        condition.expression,
        expressionContext,
      );
      if (result) {
        this.logger.debug(`条件匹配: nodeId=${nodeId}, branchId=${condition.branchId}`);
        return { branchId: condition.branchId };
      }
    }

    // 没有匹配的条件，返回默认分支
    const defaultBranch = conditions.find((c) => c.branchId === 'default')?.branchId || 'default';
    this.logger.debug(`使用默认分支: nodeId=${nodeId}, branchId=${defaultBranch}`);
    return { branchId: defaultBranch };
  }

  /**
   * 执行循环节点
   */
  private async executeLoopNode(
    nodeId: string,
    nodeData: WorkflowNode['data'],
    input: Record<string, unknown>,
    context: NodeExecutionJob['context'],
  ): Promise<unknown> {
    const loopConfig = nodeData.loopConfig;
    if (!loopConfig) {
      throw new Error('循环节点缺少 loopConfig');
    }

    const expressionContext = {
      $input: input,
      $workflow: context.input,
      $nodes: context.nodeOutputs,
    };
    const arrayData = this.safeExpression.evaluate(
      loopConfig.inputArray,
      expressionContext,
    );
    if (!Array.isArray(arrayData)) {
      throw new Error(`循环输入不是数组: ${loopConfig.inputArray}`);
    }

    this.logger.debug(`执行循环: nodeId=${nodeId}, iterations=${arrayData.length}`);

    // 检查迭代限制
    const maxIterations = 1000;
    if (arrayData.length > maxIterations) {
      throw new Error(`迭代次数超过限制: ${arrayData.length} > ${maxIterations}`);
    }

    const expression = loopConfig.expression ?? '$item';
    const results = arrayData.map((item, index) =>
      this.safeExpression.evaluate(expression, {
        ...expressionContext,
        $item: item,
        $index: index,
      }),
    );
    if (loopConfig.outputMode === 'last') {
      return results.at(-1);
    }
    return { results };
  }

  /**
   * 执行转换节点
   */
  private async executeTransformNode(
    nodeId: string,
    nodeData: WorkflowNode['data'],
    input: Record<string, unknown>,
    context: NodeExecutionJob['context'],
  ): Promise<unknown> {
    const transform = nodeData.transform;
    if (!transform || !transform.expression) {
      throw new Error('转换节点缺少 transform.expression');
    }

    this.logger.debug(`执行转换: nodeId=${nodeId}`);

    // 构建表达式上下文
    const expressionContext = {
      $input: input,
      $workflow: context.input,
      $nodes: context.nodeOutputs,
    };

    // 评估转换表达式
    return this.safeExpression.evaluate(transform.expression, expressionContext);
  }



  @OnQueueActive()
  onActive(job: Job<NodeExecutionJob>) {
    this.logger.debug(`开始处理任务: jobId=${job.id}, nodeId=${job.data.nodeId}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job<NodeExecutionJob>) {
    this.logger.debug(`任务完成: jobId=${job.id}, nodeId=${job.data.nodeId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job<NodeExecutionJob>, error: Error) {
    this.logger.error(`任务失败: jobId=${job.id}, nodeId=${job.data.nodeId}, error=${error.message}`);
  }
}
