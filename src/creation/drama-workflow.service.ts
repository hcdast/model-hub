import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { DramaWorkflowLink } from './drama-workflow.schema';
import { ShortDramaService, dramaPrompt } from '../short-drama/drama.service';
import { dramaFingerprint } from '../short-drama/drama-plan';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowRun } from '../database/schemas/workflow-run.schema';
import { ShortDramaCandidate } from '../short-drama/drama.schema';
import { applyShotReferences } from '../short-drama/drama-continuity';
import { applyFrameInput } from '../short-drama/drama-production';
import { generationDuration } from '../short-drama/drama-experience';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { Optional } from '@nestjs/common';
import { workflowTemplateSnapshot } from './creation-template-snapshot';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class DramaWorkflowService {
  constructor(@InjectModel(DramaWorkflowLink.name) private readonly links: Model<DramaWorkflowLink>,
    @InjectModel(WorkflowRun.name) private readonly runs: Model<WorkflowRun>,
    @InjectModel(ShortDramaCandidate.name) private readonly candidates: Model<ShortDramaCandidate>,
    private readonly dramas: ShortDramaService, private readonly workflows: WorkflowService, @Optional() private readonly templates?: WorkflowTemplateService) {}

  async create(ownerId: string, input: { projectId: string; shotId: string; kind: 'image' | 'video'; revision: number; templateId?: string }) {
    this.dramas.assertGenerationEnabled();
    const project = await this.dramas.get(ownerId, input.projectId);
    if (project.archived) throw new BadRequestException('请先恢复作品，再编辑高级流程');
    if (project.revision !== input.revision) throw new ConflictException('作品已更新，请刷新后重试');
    const shot = project.plan.shots.find(s => s.id === input.shotId);
    if (!shot) throw new NotFoundException('镜头不存在');
    const template = input.templateId && isValidObjectId(input.templateId) ? await this.templates?.findById(input.templateId) : undefined;
    if (input.templateId && !template?.isPublic) throw new NotFoundException('模板不存在或已下架');
    if (template && !template.workflowDefinition.nodes.some(n => (input.kind === 'image' ? ['text-to-image', 'image-to-image'] : ['text-to-video', 'image-to-video']).includes(n.type))) throw new BadRequestException('模板没有所选类型的媒体生成节点');
    const prompt = dramaPrompt(project.plan, input.kind, input.shotId);
    const models = await this.dramas.catalog();
    const model = models.find(m => m.configId === project.plan.production?.models[input.kind] && m.kinds.includes(input.kind));
    const parameters: Record<string, unknown> = Object.fromEntries((model?.params || []).filter(p => p.default !== undefined).map(p => [p.name, p.default]));
    const definitions = Object.fromEntries((model?.params || []).map(p => [p.name, p]));
    parameters[definitions.prompt || !definitions.text ? 'prompt' : 'text'] = prompt;
    if (definitions.duration) parameters.duration = generationDuration(shot.duration, definitions.duration);
    if (model) {
      applyFrameInput(parameters, definitions, project.plan, {});
      try { applyShotReferences(project.plan, input.kind, input.shotId, project.candidates, model.params, parameters); }
      catch (error) { throw new BadRequestException((error as Error).message); }
    }
    const type = input.kind === 'image' ? (model?.type === 'imageToImage' ? 'image-to-image' : 'text-to-image') : (model?.type === 'textToVideo' ? 'text-to-video' : 'image-to-video');
    const workflow = await this.workflows.create({ name: `${project.plan.title} · ${shot.title} · ${input.kind === 'image' ? '画面' : '视频'}`.slice(0, 200),
      description: '短剧镜头的自定义流程。请确认模型、素材和参数后手动运行；结果返回原镜头候选，不覆盖现有选片。',
      nodes: [{ id: 'shot', type, position: { x: 150, y: 150 }, data: { label: shot.title,
        ...(model ? { modelId: model.modelId, modelSelection: { configId: model.configId, featureType: model.type, provider: model.provider } } : {}), parameters } }], edges: [],
      ...(template ? workflowTemplateSnapshot(template.workflowDefinition) : {}),
    }, ownerId, template ? { id: String(template._id), version: template.version } : undefined);
    try {
      const link = await this.links.create({ id: randomUUID(), ownerId, projectId: project.id, shotId: shot.id, kind: input.kind,
        sourceRevision: project.revision, inputFingerprint: dramaFingerprint(project.plan, input.kind, shot.id), workflowId: String(workflow._id) });
      return this.view(link);
    } catch (error) { await this.workflows.delete(String(workflow._id), ownerId); throw error; }
  }
  async forWorkflow(ownerId: string, workflowId: string) {
    const link = await this.links.findOne({ ownerId, workflowId }).lean();
    return link ? this.view(link) : null;
  }
  private view(link: DramaWorkflowLink) {
    return { id: link.id, projectId: link.projectId, shotId: link.shotId, kind: link.kind, sourceRevision: link.sourceRevision, workflowId: link.workflowId };
  }
  async importOutput(ownerId: string, id: string, input: { runId: string; nodeId: string }) {
    const link = await this.links.findOne({ id, ownerId }).lean();
    if (!link) throw new NotFoundException('镜头流程关联不存在');
    const project = await this.dramas.get(ownerId, link.projectId);
    if (project.archived) throw new BadRequestException('请先恢复作品，再加入候选');
    if (!project.plan.shots.some(s => s.id === link.shotId)) throw new ConflictException('原镜头已删除，请返回作品检查');
    if (dramaFingerprint(project.plan, link.kind, link.shotId) !== link.inputFingerprint) throw new ConflictException('原镜头设定或选片已更新。请返回作品，以最新设定创建高级流程');
    const run = await this.runs.findOne({ runId: input.runId, workflowId: link.workflowId, triggerId: ownerId }).lean();
    if (!run) throw new NotFoundException('运行记录不存在');
    const node = run.nodeStates.find(n => n.nodeId === input.nodeId);
    const url = node?.output && typeof node.output === 'object' ? (node.output as Record<string, unknown>)[link.kind] : undefined;
    if (node?.status !== 'succeeded' || typeof url !== 'string') throw new BadRequestException('请选择已成功且类型匹配的媒体输出节点');
    try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { throw new BadRequestException('结果不是有效的媒体链接'); }
    const candidateId = createHash('sha256').update(JSON.stringify([id, input.runId, input.nodeId])).digest('hex').slice(0, 32);
    const filter = { id: candidateId, ownerId, projectId: link.projectId };
    try {
      await this.candidates.updateOne(filter, { $setOnInsert: { ...filter, kind: link.kind, targetId: link.shotId, source: 'workflow', status: 'succeeded', url,
        inputFingerprint: link.inputFingerprint, workflowOrigin: { workflowId: link.workflowId, runId: input.runId, nodeId: input.nodeId, workflowVersion: run.workflowVersion, definitionHash: run.definitionHash, sourceRevision: link.sourceRevision } } }, { upsert: true });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const candidate = await this.candidates.findOne(filter).lean();
    return { projectId: link.projectId, candidate: this.dramas.candidateView(candidate) };
  }
}
