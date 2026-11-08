import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { createHash } from 'crypto';
import { CreationTemplateSubmission } from './creation-template.schema';
import { WorkflowTemplate } from '../database/schemas/workflow-template.schema';
import { WorkflowService } from '../workflow/workflow.service';
import { ShortDramaService } from '../short-drama/drama.service';
import { dramaTemplateSnapshot, workflowTemplateSnapshot } from './creation-template-snapshot';

@Injectable()
export class CreationTemplateService {
  constructor(@InjectModel(CreationTemplateSubmission.name) private readonly submissions: Model<CreationTemplateSubmission>,
    @InjectModel(WorkflowTemplate.name) private readonly templates: Model<WorkflowTemplate>,
    private readonly workflows: WorkflowService, private readonly dramas: ShortDramaService) {}

  async submit(ownerId: string, input: { kind: 'workflow' | 'short-drama'; sourceId: string; name: string; description: string; instructions: string }) {
    let sourceRevision: number, snapshot: Record<string, unknown>;
    if (input.kind === 'short-drama') {
      const project = await this.dramas.get(ownerId, input.sourceId);
      if (!project.plan.shots.length) throw new BadRequestException('请先完成故事与分镜，再提交模板');
      sourceRevision = project.revision;
      snapshot = { dramaPlan: dramaTemplateSnapshot(project.plan) };
    } else {
      if (!isValidObjectId(input.sourceId)) throw new NotFoundException('工作流不存在');
      const workflow = await this.workflows.findById(input.sourceId, ownerId);
      if (!workflow) throw new NotFoundException('工作流不存在');
      if (!workflow.nodes.length) throw new BadRequestException('空工作流不能提交为模板');
      sourceRevision = new Date((workflow.toObject() as any).updatedAt || 0).getTime() || workflow.__v || 0;
      snapshot = { workflowDefinition: workflowTemplateSnapshot(workflow.toObject()) };
    }
    const metadata = { name: input.name.trim(), description: input.description.trim(), instructions: input.instructions.trim() };
    const sourceFingerprint = createHash('sha256').update(JSON.stringify([snapshot, metadata])).digest('hex');
    const filter = { ownerId, kind: input.kind, sourceId: input.sourceId, sourceFingerprint };
    // Retried submissions of the same content share an immutable snapshot, even after a redundant save.
    try {
      await this.submissions.updateOne(filter, { $setOnInsert: { ...filter, ...snapshot, ...metadata, sourceRevision, status: 'pending' } }, { upsert: true });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    return this.submissions.findOne(filter).lean();
  }
  async list(ownerId?: string, page = 1) {
    const filter = ownerId ? { ownerId } : {};
    const [items, total] = await Promise.all([this.submissions.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), this.submissions.countDocuments(filter)]);
    return { items, total, page, pageSize: 20 };
  }
  async review(id: string, action: 'publish' | 'reject' | 'withdraw', note: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('投稿不存在');
    const submission = await this.submissions.findById(id).select('+workflowDefinition +dramaPlan');
    if (!submission) throw new NotFoundException('投稿不存在');
    if (submission.kind === 'workflow') {
      if (action === 'publish') {
        if (!submission.workflowDefinition?.nodes.length) throw new BadRequestException('缺少工作流快照');
        await this.templates.updateOne({ _id: submission._id }, { $set: { name: submission.name, description: submission.description, instructions: submission.instructions,
          category: 'Creative', creatorId: submission.ownerId, source: 'community', authorName: 'Community creator', workflowDefinition: submission.workflowDefinition, isPublic: true, version: 1 } }, { upsert: true });
      } else await this.templates.updateOne({ _id: submission._id }, { $set: { isPublic: false } });
    }
    submission.status = action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : 'withdrawn';
    submission.reviewNote = note; submission.reviewedAt = new Date();
    await submission.save();
    return { id, status: submission.status };
  }
  async detail(id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('投稿不存在');
    const submission = await this.submissions.findById(id).select('+workflowDefinition +dramaPlan').lean();
    if (!submission) throw new NotFoundException('投稿不存在');
    return submission;
  }
  async publishedDramaPage(search: string, skip: number, limit: number) {
    const filter: Record<string, unknown> = { kind: 'short-drama', status: 'published' };
    if (search) { const text = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['name', 'description'].map(key => ({ [key]: { $regex: text, $options: 'i' } })); }
    const [items, total] = await Promise.all([this.submissions.find(filter).select('+dramaPlan').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), this.submissions.countDocuments(filter)]);
    return { items, total };
  }
  async publishedDramaSummaries(search: string) {
    const filter: Record<string, unknown> = { kind: 'short-drama', status: 'published' };
    if (search) { const text = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['name', 'description'].map(key => ({ [key]: { $regex: text, $options: 'i' } })); }
    return this.submissions.aggregate([{ $match: filter }, { $sort: { createdAt: -1, _id: -1 } }, { $project: { name: 1, description: 1, createdAt: 1, shotCount: { $size: { $ifNull: ['$dramaPlan.shots', []] } }, ratio: { $ifNull: ['$dramaPlan.frame.ratio', '9:16'] } } }]).exec();
  }
  async publishedDrama(id: string) {
    if (!isValidObjectId(id)) return null;
    return this.submissions.findOne({ _id: id, kind: 'short-drama', status: 'published' }).select('+dramaPlan').lean();
  }
}
