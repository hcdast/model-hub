import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import {
  PortalUser,
  PortalUserDocument,
} from '../database/schemas/portal-user.schema';
import {
  Workflow,
  WorkflowDocument,
  WorkflowNode,
} from '../database/schemas/workflow.schema';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { getRolePermissions } from '../portal-auth/role-permissions.config';

@Injectable()
export class WorkflowPolicyService {
  constructor(
    @InjectModel(PortalUser.name)
    private readonly portalUserModel: Model<PortalUserDocument>,
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async assertCanCreate(ownerId: string, nodes: WorkflowNode[]): Promise<boolean> {
    await this.assertNodesAllowed(ownerId, nodes);
    const user = await this.findPortalUser(ownerId);
    if (!user) return false;
    const maxCount = getRolePermissions(user.role).workflow.maxCount;
    const existingCount = await this.workflowModel.countDocuments({
      creatorId: ownerId,
    });
    await this.portalUserModel.updateOne(
      { _id: ownerId },
      [
        {
          $set: {
            workflowCount: {
              $max: [{ $ifNull: ['$workflowCount', 0] }, existingCount],
            },
          },
        },
      ],
    );
    const filter: Record<string, unknown> = {
      _id: ownerId,
      deletedAt: null,
      status: 'active',
    };
    if (maxCount !== -1) {
      filter.$expr = {
        $lt: [{ $ifNull: ['$workflowCount', 0] }, maxCount],
      };
    }
    const claimed = await this.portalUserModel.findOneAndUpdate(
      filter,
      { $inc: { workflowCount: 1 } },
      { new: true },
    );
    if (!claimed) {
      throw new ForbiddenException({
        code: 'WORKFLOW_LIMIT_EXCEEDED',
        message: `Workflow count limit is ${maxCount}`,
      });
    }
    return true;
  }

  async assertNodesAllowed(ownerId: string, nodes: WorkflowNode[]): Promise<void> {
    const user = await this.findPortalUser(ownerId);
    if (!user) return;
    const permissions = getRolePermissions(user.role);
    if (
      permissions.workflow.maxNodesPerWorkflow !== -1 &&
      nodes.length > permissions.workflow.maxNodesPerWorkflow
    ) {
      throw new ForbiddenException({
        code: 'WORKFLOW_LIMIT_EXCEEDED',
        message: `Workflow node limit is ${permissions.workflow.maxNodesPerWorkflow}`,
      });
    }
    if (
      !permissions.features.canUseLoop &&
      nodes.some((node) => node.type === 'loop')
    ) {
      throw new ForbiddenException({
        code: 'WORKFLOW_FEATURE_NOT_ALLOWED',
        message: 'Loop nodes are not available for this role',
      });
    }
    if (
      !permissions.features.canUseCondition &&
      nodes.some((node) => node.type === 'condition')
    ) {
      throw new ForbiddenException({
        code: 'WORKFLOW_FEATURE_NOT_ALLOWED',
        message: 'Condition nodes are not available for this role',
      });
    }
    const allowedModels = permissions.models.allowedModels;
    const deniedModel = nodes
      .map((node) => node.data?.modelId)
      .find(
        (modelId): modelId is string =>
          Boolean(modelId) &&
          allowedModels.length > 0 &&
          !allowedModels.some((pattern) => this.matchModel(pattern, modelId!)),
      );
    if (deniedModel) {
      throw new ForbiddenException({
        code: 'MODEL_NOT_ALLOWED',
        message: `Model is not available for this role: ${deniedModel}`,
      });
    }
  }

  async acquireRun(
    ownerId: string,
    runId: string,
  ): Promise<{ timeoutSeconds: number; acquired: boolean }> {
    const user = await this.findPortalUser(ownerId);
    if (!user) return { timeoutSeconds: 300, acquired: false };
    const permissions = getRolePermissions(user.role);
    const key = `workflow:concurrency:${ownerId}`;
    const now = Date.now();
    const expiresAt = now + permissions.workflow.executionTimeout * 1000;
    const script = `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      local count = redis.call('ZCARD', KEYS[1])
      if count >= tonumber(ARGV[2]) then return 0 end
      redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
      redis.call('PEXPIRE', KEYS[1], ARGV[5])
      return 1
    `;
    const acquired = await this.redis.eval(
      script,
      1,
      key,
      now,
      permissions.workflow.maxConcurrentRuns,
      expiresAt,
      runId,
      permissions.workflow.executionTimeout * 1000 + 60_000,
    );
    if (Number(acquired) !== 1) {
      throw new HttpException(
        {
          code: 'WORKFLOW_CONCURRENCY_EXCEEDED',
          message: `Concurrent run limit is ${permissions.workflow.maxConcurrentRuns}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return {
      timeoutSeconds: permissions.workflow.executionTimeout,
      acquired: true,
    };
  }

  async releaseRun(ownerId: string, runId: string): Promise<void> {
    await this.redis.zrem(`workflow:concurrency:${ownerId}`, runId);
  }

  async releaseWorkflowSlot(ownerId: string): Promise<void> {
    await this.portalUserModel.updateOne(
      { _id: ownerId },
      [
        {
          $set: {
            workflowCount: {
              $max: [0, { $subtract: [{ $ifNull: ['$workflowCount', 1] }, 1] }],
            },
          },
        },
      ],
    );
  }

  private async findPortalUser(ownerId: string): Promise<PortalUserDocument | null> {
    if (!/^[a-f\d]{24}$/i.test(ownerId)) return null;
    return this.portalUserModel.findOne({
      _id: ownerId,
      deletedAt: null,
      status: 'active',
    });
  }

  private matchModel(pattern: string, modelId: string): boolean {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')}$`,
    );
    return regex.test(modelId);
  }
}
