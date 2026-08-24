import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  Workflow,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../database/schemas/workflow.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowPolicyService } from './workflow-policy.service';

/**
 * 工作流 CRUD 服务
 * 负责工作流定义的创建、查询、更新、删除操作
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowPolicy: WorkflowPolicyService,
  ) {}

  /**
   * 创建工作流
   * @param dto 创建工作流 DTO
   * @param creatorId 创建者 ID（API Client ID 或用户 ID）
   * @returns 创建的工作流文档
   */
  async create(
    dto: {
      name?: string;
      description?: string;
      nodes: WorkflowNode[];
      edges?: WorkflowEdge[];
      viewport?: any;
      inputSchema?: Record<string, any>;
      outputMapping?: Record<string, string>;
      executionConfig?: any;
      tags?: string[];
    },
    creatorId: string,
  ): Promise<WorkflowDocument> {
    const slotClaimed = await this.workflowPolicy.assertCanCreate(
      creatorId,
      dto.nodes,
    );
    this.logger.log(`创建工作流: name=${dto.name || 'Untitled Workflow'}, creatorId=${creatorId}`);

    const workflow = new this.workflowModel({
      ...dto,
      creatorId,
      status: 'draft',
      edges: dto.edges || [],
      tags: dto.tags || [],
      executionConfig: dto.executionConfig || {},
    });

    let saved: WorkflowDocument;
    try {
      saved = await workflow.save();
    } catch (error) {
      if (slotClaimed) {
        await this.workflowPolicy.releaseWorkflowSlot(creatorId);
      }
      throw error;
    }

    // 发送工作流创建事件
    this.eventEmitter.emit('workflow.created', {
      workflowId: saved._id,
      creatorId,
      name: saved.name,
    });

    this.logger.log(`工作流创建成功: id=${saved._id}, name=${saved.name}`);
    return saved;
  }

  /**
   * 根据 ID 查找工作流
   * @param id 工作流 ID
   * @returns 工作流文档，不存在则返回 null
   */
  async findById(id: string, creatorId?: string): Promise<WorkflowDocument | null> {
    this.logger.debug(`查找工作流: id=${id}, creatorId=${creatorId ?? 'admin'}`);

    const workflow = await this.workflowModel
      .findOne(creatorId ? { _id: id, creatorId } : { _id: id })
      .exec();

    if (!workflow) {
      this.logger.warn(`工作流不存在: id=${id}`);
      return null;
    }

    return workflow;
  }

  /**
   * 更新工作流
   * @param id 工作流 ID
   * @param dto 更新数据（支持部分更新）
   * @returns 更新后的工作流文档
   */
  async update(
    id: string,
    dto: {
      name?: string;
      description?: string;
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
      viewport?: unknown;
      inputSchema?: Record<string, unknown>;
      outputMapping?: Record<string, string>;
      executionConfig?: unknown;
      tags?: string[];
      status?: string;
    },
    creatorId?: string,
  ): Promise<WorkflowDocument> {
    if (dto.nodes) {
      if (!creatorId) {
        throw new ConflictException('Owner is required when updating workflow nodes');
      }
      await this.workflowPolicy.assertNodesAllowed(creatorId, dto.nodes);
    }
    this.logger.log(`更新工作流: id=${id}, creatorId=${creatorId ?? 'admin'}`);

    const workflow = await this.workflowModel
      .findOne(creatorId ? { _id: id, creatorId } : { _id: id })
      .exec();

    if (!workflow) {
      this.logger.warn(`工作流不存在，无法更新: id=${id}`);
      throw new NotFoundException(`工作流不存在: ${id}`);
    }

    // 应用部分更新
    Object.assign(workflow, dto);

    const updated = await workflow.save();

    // 发送工作流更新事件
    this.eventEmitter.emit('workflow.updated', {
      workflowId: updated._id,
      updates: Object.keys(dto),
    });

    this.logger.log(`工作流更新成功: id=${updated._id}`);
    return updated;
  }

  /**
   * 删除工作流
   * @param id 工作流 ID
   */
  async delete(id: string, creatorId?: string): Promise<void> {
    this.logger.log(`删除工作流: id=${id}, creatorId=${creatorId ?? 'admin'}`);

    const deleted = await this.workflowModel
      .findOneAndDelete(creatorId ? { _id: id, creatorId } : { _id: id })
      .exec();

    if (!deleted) {
      this.logger.warn(`工作流不存在，无法删除: id=${id}`);
      throw new NotFoundException(`工作流不存在: ${id}`);
    }
    await this.workflowPolicy.releaseWorkflowSlot(deleted.creatorId);

    // 发送工作流删除事件
    this.eventEmitter.emit('workflow.deleted', { workflowId: id });

    this.logger.log(`工作流删除成功: id=${id}`);
  }

  /**
   * 查询工作流列表（分页）
   * @param query 查询参数
   * @returns 分页结果
   */
  async list(query: {
    creatorId?: string;
    status?: string;
    tags?: string[];
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: WorkflowDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { creatorId, status, tags } = query;
    const keyword = query.keyword?.trim().slice(0, 100);
    const page = Math.max(1, Math.trunc(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.trunc(Number(query.pageSize) || 20)),
    );

    this.logger.debug(
      `查询工作流列表: creatorId=${creatorId}, status=${status}, tags=${tags?.join(',')}, page=${page}, pageSize=${pageSize}`,
    );

    const filter: FilterQuery<WorkflowDocument> = {};

    if (creatorId) {
      filter.creatorId = creatorId;
    }

    if (status) {
      filter.status = status;
    }

    if (tags && tags.length > 0) {
      filter.tags = { $all: tags };
    }
    if (keyword) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escapedKeyword, $options: 'i' };
    }

    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.workflowModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.workflowModel.countDocuments(filter).exec(),
    ]);

    this.logger.debug(`查询到 ${items.length} 条工作流记录，总计 ${total} 条`);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }
}
