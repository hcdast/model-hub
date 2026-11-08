import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { createHash } from 'crypto';
import { CreationEvent } from './creation-event.schema';
import { WorkflowTemplate } from '../database/schemas/workflow-template.schema';
import { CreationTemplateSubmission } from './creation-template.schema';
import { ShortDramaProject, ShortDramaCandidate, ShortDramaQuote } from '../short-drama/drama.schema';
import { DRAMA_TEMPLATES } from '../short-drama/drama-templates';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class CreationEventService {
  constructor(@InjectModel(CreationEvent.name) private readonly events: Model<CreationEvent>,
    @InjectModel(WorkflowTemplate.name) private readonly templates: Model<WorkflowTemplate>,
    @InjectModel(CreationTemplateSubmission.name) private readonly submissions: Model<CreationTemplateSubmission>,
    @InjectModel(ShortDramaProject.name) private readonly projects: Model<ShortDramaProject>,
    @InjectModel(ShortDramaCandidate.name) private readonly candidates: Model<ShortDramaCandidate>,
    @InjectModel(ShortDramaQuote.name) private readonly quotes: Model<ShortDramaQuote>) {}

  async publicEvent(input: { name: string; kind: 'workflow' | 'short-drama'; templateId: string; sessionId: string }) {
    let exists: unknown = false;
    if (input.kind === 'short-drama' && process.env.DRAMA_TEMPLATES_ENABLED !== 'false' && process.env.DRAMA_CREATE_ENABLED !== 'false') {
      exists = DRAMA_TEMPLATES.some(t => t.id === input.templateId) || (isValidObjectId(input.templateId) && await this.submissions.exists({ _id: input.templateId, kind: 'short-drama', status: 'published' }));
    } else if (input.kind === 'workflow' && isValidObjectId(input.templateId)) exists = await this.templates.exists({ _id: input.templateId, isPublic: true });
    if (!exists) throw new NotFoundException('模板不存在或已下架');
    await this.record(input.name, input.kind, hash(['session', input.sessionId]), { templateId: input.templateId });
    return { accepted: true };
  }

  async privateEvent(ownerId: string, input: { name: string; projectId: string; referenceId: string }) {
    const project = await this.projects.findOne({ id: input.projectId, ownerId }).select('id').lean();
    if (!project) throw new NotFoundException('作品不存在');
    if (input.name === 'quote_viewed') {
      if (!await this.quotes.exists({ id: input.referenceId, projectId: input.projectId, ownerId })) throw new BadRequestException('报价不存在');
    } else {
      const candidate = await this.candidates.findOne({ id: input.referenceId, projectId: input.projectId, ownerId, status: 'succeeded' }).lean();
      if (!candidate || (input.name === 'download_started' && (candidate.kind !== 'export' || !candidate.url))) throw new BadRequestException('可用候选不存在');
    }
    await this.record(input.name, 'short-drama', hash(['owner', ownerId]), { projectId: input.projectId });
    return { accepted: true };
  }

  private async record(name: string, kind: string, subject: string, target: { templateId?: string; projectId?: string }) {
    const at = new Date(), key = hash([name, kind, subject, target, at.toISOString().slice(0, 10)]);
    try { await this.events.updateOne({ key }, { $setOnInsert: { key, name, kind, subject, ...target, at } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  }

  async funnel(kind: 'workflow' | 'short-drama') {
    const to = new Date(), from = new Date(to.getTime() - 30 * 86400000);
    const rows = await this.events.aggregate([{ $match: { kind, at: { $gte: from, $lte: to } } },
      { $group: { _id: { name: '$name', unit: { $ifNull: ['$projectId', '$subject'] } } } },
      { $group: { _id: '$_id.name', count: { $sum: 1 } } }]).option({ maxTimeMS: 10000 }).exec();
    const counts = Object.fromEntries(rows.map(r => [r._id, r.count]));
    return { from: from.toISOString(), to: to.toISOString(), counts, retentionDays: 90 };
  }
}
