import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { WorkflowRun, WorkflowRunDocument } from '../database/schemas/workflow-run.schema';
import { Workflow, WorkflowDocument } from '../database/schemas/workflow.schema';
import { ShortDramaCandidate, ShortDramaProject } from '../short-drama/drama.schema';

const terminalStatuses = ['succeeded', 'failed', 'cancelled'];
const unreadExpression = {
  $lt: [{ $ifNull: ['$notificationReadAt', new Date(0)] }, '$completedAt'],
};

/** Read persisted execution results so notifications survive process restarts and missed events. */
@Injectable()
export class PortalNotificationService {
  constructor(
    @InjectModel(WorkflowRun.name) private readonly runs: Model<WorkflowRunDocument>,
    @InjectModel(Workflow.name) private readonly workflows: Model<WorkflowDocument>,
    @Optional() @InjectModel(ShortDramaCandidate.name) private readonly drama?: Model<ShortDramaCandidate>,
    @Optional() @InjectModel(ShortDramaProject.name) private readonly projects?: Model<ShortDramaProject>,
  ) {}

  private filter(userId: string, unreadOnly = false): FilterQuery<WorkflowRunDocument> {
    return {
      triggerId: userId,
      status: { $in: terminalStatuses },
      completedAt: { $type: 'date' },
      ...(unreadOnly ? { $expr: unreadExpression } : {}),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return await this.runs.countDocuments(this.filter(userId, true)).exec() + (this.drama ? await this.drama.countDocuments(this.dramaFilter(userId, true)).exec() : 0);
  }
  private dramaFilter(ownerId: string, unreadOnly = false) { return { ownerId, status: { $in: ['succeeded', 'failed'] }, completedAt: { $type: 'date' }, ...(unreadOnly ? { $expr: unreadExpression } : {}) }; }

  async list(userId: string, page: number, pageSize: number, unreadOnly = false) {
    const filter = this.filter(userId, unreadOnly);
    const [runs, workflowTotal, unreadCount] = await Promise.all([
      this.runs.find(filter)
        .select('runId workflowId status completedAt notificationReadAt')
        .sort({ completedAt: -1, runId: 1 }).limit(page * pageSize).lean().exec(),
      this.runs.countDocuments(filter).exec(),
      this.unreadCount(userId),
    ]);
    // Only owned, still-existing workflows get a navigation link. Never include run inputs/outputs or errors.
    const workflows = runs.length ? await this.workflows.find({
      _id: { $in: runs.map(run => run.workflowId).filter(id => /^[a-f\d]{24}$/i.test(id)) },
      creatorId: userId,
    }).select('_id name').lean().exec() : [];
    const names = new Map(workflows.map(workflow => [String(workflow._id), workflow.name]));
    const items: Array<{ id: string; type: 'workflow_run' | 'drama_result'; status: string; workflowName: string | null; href: string | null; createdAt: Date | undefined; read: boolean }> = runs.map(run => ({
      id: run.runId,
      type: 'workflow_run' as const,
      status: run.status,
      workflowName: names.get(run.workflowId) ?? null,
      href: names.has(run.workflowId) ? `/workflows/${run.workflowId}` : null,
      createdAt: run.completedAt,
      read: !!run.notificationReadAt && run.notificationReadAt >= run.completedAt!,
    }));
    let total = workflowTotal;
    if (this.drama && this.projects) {
      const filter = this.dramaFilter(userId, unreadOnly);
      const [results, count] = await Promise.all([this.drama.find(filter).select('id projectId kind status completedAt notificationReadAt').sort({ completedAt: -1, id: 1 }).limit(page * pageSize).lean(), this.drama.countDocuments(filter)]);
      total += count;
      const projects = await this.projects.find({ ownerId: userId, id: { $in: results.map(c => c.projectId) } }).select('id plan.title').lean();
      const titles = new Map(projects.map(p => [p.id, p.plan.title]));
      results.forEach(c => items.push({ id: c.id, type: 'drama_result', status: c.status, workflowName: titles.get(c.projectId) || null, href: titles.has(c.projectId) ? `/short-dramas/${c.projectId}` : null, createdAt: c.completedAt, read: !!c.notificationReadAt && c.notificationReadAt >= c.completedAt! }));
    }
    items.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0) || a.id.localeCompare(b.id));
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, unreadCount };
  }

  async markRead(userId: string, runId: string) {
    // Snapshot the completion, not wall time: a subsequent retry's result becomes unread.
    const result = await this.runs.updateOne(
      { ...this.filter(userId), runId },
      [{ $set: { notificationReadAt: '$completedAt' } }],
    ).exec();
    if (!result.matchedCount) {
      const matched = await this.drama?.updateOne({ ...this.dramaFilter(userId), id: runId }, [{ $set: { notificationReadAt: '$completedAt' } }]);
      if (!matched?.matchedCount) throw new NotFoundException('Notification not found');
    }
    return { count: await this.unreadCount(userId) };
  }

  async markAllRead(userId: string) {
    const filter = this.filter(userId, true);
    filter.completedAt = { $type: 'date', $lte: new Date() };
    const result = await this.runs.updateMany(filter,
      [{ $set: { notificationReadAt: '$completedAt' } }],
    ).exec();
    const drama = await this.drama?.updateMany({ ...this.dramaFilter(userId, true), completedAt: { $type: 'date', $lte: new Date() } }, [{ $set: { notificationReadAt: '$completedAt' } }]);
    return { modifiedCount: result.modifiedCount + (drama?.modifiedCount || 0), count: await this.unreadCount(userId) };
  }
}
