import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Workflow } from '../database/schemas/workflow.schema';
import { WorkflowTemplate } from '../database/schemas/workflow-template.schema';
import { ShortDramaProject } from '../short-drama/drama.schema';
import { CreationTemplateSubmission } from './creation-template.schema';
import { DRAMA_TEMPLATES } from '../short-drama/drama-templates';

export type TemplateKind = 'workflow' | 'short-drama';
export interface TemplateMetrics {
  copies: number; creators: number; startedProjects: number; completedProjects: number;
  startedCreators: number; completedCreators: number;
}
export const emptyTemplateMetrics = (): TemplateMetrics => ({ copies: 0, creators: 0, startedProjects: 0, completedProjects: 0, startedCreators: 0, completedCreators: 0 });
export function recommendationScore(metrics?: TemplateMetrics): number {
  return metrics ? 3 * Math.log1p(metrics.completedCreators) + Math.log1p(metrics.startedCreators) + 0.25 * Math.log1p(metrics.creators) : 0;
}

/** Derived from owned projects and actual runs; clients cannot report a successful conversion. */
@Injectable()
export class TemplateInsightsService {
  private readonly cache = new Map<TemplateKind, { at: number; metrics: Map<string, TemplateMetrics> }>();
  private readonly pending = new Map<TemplateKind, Promise<{ at: number; metrics: Map<string, TemplateMetrics> }>>();
  constructor(
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    @InjectModel(ShortDramaProject.name) private readonly projects: Model<ShortDramaProject>,
    @InjectModel(WorkflowTemplate.name) private readonly templates: Model<WorkflowTemplate>,
    @InjectModel(CreationTemplateSubmission.name) private readonly submissions: Model<CreationTemplateSubmission>,
  ) {}

  async metrics(kind: TemplateKind) {
    const cached = this.cache.get(kind);
    if (cached && Date.now() - cached.at < 60000) return cached;
    const pending = this.pending.get(kind);
    if (pending) return pending;
    const request = this.collect(kind).then(metrics => {
      const result = { at: Date.now(), metrics }; this.cache.set(kind, result); return result;
    }).finally(() => { this.pending.delete(kind); });
    this.pending.set(kind, request);
    return request;
  }

  private async collect(kind: TemplateKind): Promise<Map<string, TemplateMetrics>> {
    const drama = kind === 'short-drama';
    const rows = await (drama ? this.projects : this.workflows).aggregate([
      { $match: { 'templateSource.id': { $type: 'string' } } },
      { $project: { templateId: '$templateSource.id', ownerId: drama ? '$ownerId' : '$creatorId', projectId: drama ? '$id' : { $toString: '$_id' } } },
      { $lookup: { from: drama ? 'short_drama_candidates' : 'workflow_runs', let: { id: '$projectId', owner: '$ownerId' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: [drama ? '$projectId' : '$workflowId', '$$id'] }, { $eq: [drama ? '$ownerId' : '$triggerId', '$$owner'] }] } } },
        { $group: { _id: null,
          started: { $max: drama ? { $cond: [{ $in: ['$source', ['model', 'render', 'workflow']] }, 1, 0] } : { $literal: 1 } },
          completed: { $max: { $cond: [drama ? { $and: [{ $eq: ['$kind', 'export'] }, { $eq: ['$source', 'render'] }, { $eq: ['$status', 'succeeded'] }] } : { $eq: ['$status', 'succeeded'] }, 1, 0] } },
        } },
      ], as: 'activity' } },
      { $unwind: { path: '$activity', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { templateId: '$templateId', ownerId: '$ownerId' }, copies: { $sum: 1 }, startedProjects: { $sum: { $ifNull: ['$activity.started', 0] } }, completedProjects: { $sum: { $ifNull: ['$activity.completed', 0] } } } },
      { $group: { _id: '$_id.templateId', copies: { $sum: '$copies' }, creators: { $sum: 1 }, startedProjects: { $sum: '$startedProjects' }, completedProjects: { $sum: '$completedProjects' },
        startedCreators: { $sum: { $cond: [{ $gt: ['$startedProjects', 0] }, 1, 0] } }, completedCreators: { $sum: { $cond: [{ $gt: ['$completedProjects', 0] }, 1, 0] } },
      } },
    ]).option({ maxTimeMS: 10000 }).exec();
    return new Map(rows.map(({ _id, ...metrics }) => [String(_id), metrics as TemplateMetrics]));
  }

  async overview(kind: TemplateKind, page = 1) {
    const result = await this.metrics(kind);
    const metadata = kind === 'workflow'
      ? (await this.templates.find({}).select('name isPublic source').lean()).map(t => ({ id: String(t._id), name: t.name, published: t.isPublic, source: t.source || 'official' }))
      : [...DRAMA_TEMPLATES.map(t => ({ id: t.id, name: t.name, published: this.dramaAvailable(), source: 'official' })),
        ...(await this.submissions.find({ kind: 'short-drama', status: { $in: ['published', 'withdrawn'] } }).select('name status').lean()).map(t => ({ id: String(t._id), name: t.name, published: t.status === 'published' && this.dramaAvailable(), source: 'community' }))];
    const known = new Set(metadata.map(t => t.id));
    for (const id of result.metrics.keys()) if (!known.has(id)) metadata.push({ id, name: '已删除或不可用的模板', published: false, source: 'unknown' });
    const items = metadata.map(t => ({ ...t, kind, metrics: result.metrics.get(t.id) || emptyTemplateMetrics() }))
      .sort((a, b) => recommendationScore(b.metrics) - recommendationScore(a.metrics) || a.id.localeCompare(b.id));
    const totals = items.reduce((total, item) => {
      for (const key of ['copies', 'startedProjects', 'completedProjects'] as const) total[key] += item.metrics[key];
      return total;
    }, { copies: 0, startedProjects: 0, completedProjects: 0 });
    return { items: items.slice((page - 1) * 20, page * 20), total: items.length, page, pageSize: 20, totals, computedAt: new Date(result.at).toISOString() };
  }
  private dramaAvailable() { return process.env.DRAMA_TEMPLATES_ENABLED !== 'false' && process.env.DRAMA_CREATE_ENABLED !== 'false'; }
}
