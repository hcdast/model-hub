/*
 * 工作流模板服务
 * 提供模板的 CRUD 和发布管理
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WorkflowTemplate,
  WorkflowTemplateDocument,
} from '../database/schemas/workflow-template.schema';
import { CreateWorkflowTemplateDto, UpdateWorkflowTemplateDto, ListTemplateCatalogDto } from './dto/workflow-template.dto';

/**
 * 工作流模板服务
 */
@Injectable()
export class WorkflowTemplateService {
  private readonly logger = new Logger(WorkflowTemplateService.name);

  constructor(
    @InjectModel(WorkflowTemplate.name)
    private readonly templateModel: Model<WorkflowTemplateDocument>,
  ) {}

  /**
   * 创建模板
   */
  async create(
    dto: CreateWorkflowTemplateDto & { creatorId?: string },
  ): Promise<WorkflowTemplateDocument> {
    this.logger.log(`创建模板: name=${dto.name}`);

    const template = new this.templateModel({
      ...dto,
      tags: dto.tags || [],
      isPublic: false,
      version: 1,
    });

    return template.save();
  }

  /**
   * 根据 ID 查找模板
   */
  async findById(id: string): Promise<WorkflowTemplateDocument | null> {
    return this.templateModel.findById(id);
  }

  /**
   * 更新模板
   */
  async update(
    id: string,
    dto: UpdateWorkflowTemplateDto,
  ): Promise<WorkflowTemplateDocument> {
    this.logger.log(`更新模板: id=${id}`);

    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException(`模板不存在: ${id}`);
    }

    Object.assign(template, dto);
    template.version += 1;

    return template.save();
  }

  /**
   * 删除模板
   */
  async delete(id: string): Promise<void> {
    const result = await this.templateModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`模板不存在: ${id}`);
    }
    this.logger.log(`模板删除成功: id=${id}`);
  }

  /**
   * 查询公开模板列表
   */
  async listPublic(query: ListTemplateCatalogDto & {
    tags?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: WorkflowTemplateDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const category = query.category;
    const tags = query.tags;
    const page = Math.max(1, Math.trunc(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.trunc(Number(query.pageSize) || 20)),
    );

    const filter: Record<string, unknown> = { isPublic: true };

    if (category) {
      filter.category = category;
    }

    if (query.source === 'official') {
      filter.$or = [{ source: 'official' }, { source: { $exists: false } }];
    } else if (query.source) {
      filter.source = query.source;
    }
    if (query.scenario) filter.scenario = query.scenario;
    if (query.search?.trim()) {
      const search = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [{ $or: ['name', 'description', 'tags', 'authorName', 'workflowDefinition.nodes.data.modelId'].map(field => ({ [field]: { $regex: search, $options: 'i' } })) }];
    }

    if (tags?.length) {
      filter.tags = { $all: tags.slice(0, 20) };
    }

    const skip = (page - 1) * pageSize;

    const sort: Record<string, 1 | -1> = query.order === 'name' ? { name: 1, _id: 1 }
      : query.order === 'updated' ? { updatedAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };
    const [items, total] = await Promise.all([
      this.templateModel.find(filter).sort(sort).skip(skip).limit(pageSize).exec(),
      this.templateModel.countDocuments(filter).exec(),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * 发布模板
   */
  async publish(id: string): Promise<WorkflowTemplateDocument> {
    this.logger.log(`发布模板: id=${id}`);

    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException(`模板不存在: ${id}`);
    }

    template.isPublic = true;
    return template.save();
  }

  /**
   * 取消发布模板
   */
  async unpublish(id: string): Promise<WorkflowTemplateDocument> {
    this.logger.log(`取消发布模板: id=${id}`);

    const template = await this.templateModel.findById(id);
    if (!template) {
      throw new NotFoundException(`模板不存在: ${id}`);
    }

    template.isPublic = false;
    return template.save();
  }
}
