import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { CreationTemplateSubmission } from '../creation/creation-template.schema';
import { WorkflowBudgetService } from '../creation/workflow-budget.service';
import { appendDramaStage } from '../creation/drama-stage-template';
import { createHash, randomUUID } from 'crypto';
import { ShortDramaProject, ShortDramaCandidate, ShortDramaQuote } from './drama.schema';
import { DramaKind, DramaPlan, DramaCandidate, emptyDramaPlan } from './drama.types';
import { dramaFingerprint, normalizeDramaPlan, readDramaOutput, validateSelections } from './drama-plan';
import { ModelConfig } from '../database/schemas/model-config.schema';
import { WorkflowAsset } from '../database/schemas/workflow-asset.schema';
import { PortalApiKeyService } from '../portal-auth/portal-api-key.service';
import { TaskService } from '../task/task.service';
import { WorkflowPolicyService } from '../workflow/workflow-policy.service';
import { validateParams } from '../common/utils/param-validator';
import { estimateModelPrice } from '../common/utils/model-pricing';
import { applyFrameInput, budgetSummary, roleInputs } from './drama-production';
import { WorkflowAssetService } from '../workflow/workflow-asset.service';
import { downloadDramaMedia } from './drama-render.service';
import { Interval } from '@nestjs/schedule';
import { DRAMA_TEMPLATES, templatePlan } from './drama-templates';
import { dramaMediaMime } from './drama-media';
import { AkoolOpenapiAdapter } from '../provider/adapters/akool-openapi.adapter';
import { generationDuration } from './drama-experience';
import { applyShotReferences, referenceUsage, shotReferences } from './drama-continuity';

export const DRAMA_MODEL_TYPES: Partial<Record<DramaKind, string[]>> = {
  script: ['textGenerate'], character: ['textToImage'], scene: ['textToImage'], image: ['imageToImage', 'textToImage'],
  video: ['imageToVideo', 'textToVideo'], voice: ['tts'], music: ['music'],
};
export const dramaMedia = (kind: DramaKind): 'text' | 'image' | 'video' | 'audio' => kind === 'script' ? 'text' : ['voice', 'music'].includes(kind) ? 'audio' : ['video', 'export'].includes(kind) ? 'video' : 'image';
const configFingerprint = (config: ModelConfig) => createHash('sha256').update(JSON.stringify([config.revision, config.params, config.params_rules, config.unit_price_map, config.pricing, config.provider])).digest('hex');
const OUTPUT_FORMAT_ERROR = '任务成功，但返回格式中没有可使用的结果。请检查模型输出配置。';
// Also translate legacy failures on read; never expose internal billing identifiers.
function candidateError(message?: string, code?: string): string | undefined {
  if (message && (/_401$/.test(code || '') || /status code 401|Invalid Token/i.test(message))) {
    return '模型服务认证失败。请联系管理员检查供应商凭证，修复后再重新制作。已有作品和素材已保留。';
  }
  if (!message || !message.startsWith('Insufficient balance for client ')) return message;
  const required = message.match(/required: (\d+(?:\.\d+)?)/)?.[1];
  return `账号可用余额不足${required ? `，此项需要 ${required} 积分` : ''}。请联系管理员补足账号余额后重试。项目预算不会增加账号余额。已有作品和素材已保留。`;
}
export function dramaPrompt(plan: DramaPlan, kind: DramaKind, targetId: string): string {
  if (kind === 'script') return `你是短剧编剧。基于下方故事，写一集约 ${plan.duration} 秒的${plan.style}旁白短剧。返回纯 JSON，不用 Markdown：{"title":"标题","story":"完整故事","characters":[{"name":"姓名","description":"稳定的外貌与服装设定"}],"scenes":[{"name":"名称","description":"环境描述"}],"shots":[{"title":"镜头标题","description":"画面和运镜","narration":"旁白","duration":5,"characters":["姓名"],"scene":"场景名称"}]}。每镜头2至15秒，总时长不超过180秒，最多24镜头，角色和场景各不超过8个。\n故事：${plan.story}`;
  if (kind === 'character' || kind === 'scene') { const role = (kind === 'character' ? plan.characters : plan.scenes).find(x => x.id === targetId); if (!role) throw new BadRequestException('角色或场景不存在'); return `${plan.style}，${role.name}，${role.description}，统一美术风格，无文字无水印。`; }
  if (kind === 'music') return `${plan.style}短剧配乐，${plan.duration}秒，无人声，轻柔衬托旁白。故事：${plan.story.slice(0, 1000)}`;
  const shot = plan.shots.find(s => s.id === targetId); if (!shot) throw new BadRequestException('镜头不存在');
  if (kind === 'voice') { if (!shot.narration.trim()) throw new BadRequestException('这个镜头还没有旁白'); return shot.narration; }
  // A product style name is not a request for a comic page or a storyboard sheet.
  const visualStyle = plan.style === '绘本漫剧' ? '绘本插画风格' : plan.style;
  const composition = kind === 'image' ? '单幅完整画面，单一连续构图，只描绘一个镜头中的一个瞬间，画面铺满整个画布。' : '连续的单镜头视频，保持统一构图。';
  return `${visualStyle}。${composition}画面：${shot.description}。角色设定：${shot.characterIds.map(id => { const r = plan.characters.find(x => x.id === id); return r ? `${r.name}：${r.description}` : ''; }).join('；')}。场景：${plan.scenes.find(x => x.id === shot.sceneId)?.description || '按画面描述'}。保持角色外貌与服装一致，无文字无水印。`;
}

@Injectable()
export class ShortDramaService {
  private synchronizing = false;
  constructor(
    @InjectModel(ShortDramaProject.name) private readonly projects: Model<ShortDramaProject>,
    @InjectModel(ShortDramaCandidate.name) private readonly candidates: Model<ShortDramaCandidate>,
    @InjectModel(ShortDramaQuote.name) private readonly quotes: Model<ShortDramaQuote>,
    @InjectModel(ModelConfig.name) private readonly models: Model<ModelConfig>,
    @InjectModel(WorkflowAsset.name) private readonly assets: Model<WorkflowAsset>,
    private readonly keys: PortalApiKeyService,
    private readonly tasks: TaskService,
    private readonly policy: WorkflowPolicyService,
    @Optional() private readonly assetStorage?: WorkflowAssetService,
    @Optional() private readonly openapi?: AkoolOpenapiAdapter,
    @Optional() @InjectModel(CreationTemplateSubmission.name) private readonly templateSubmissions?: Model<CreationTemplateSubmission>,
    @Optional() private readonly workflowBudget?: WorkflowBudgetService,
  ) {}

  async find(ownerId: string, id: string) {
    const project = await this.projects.findOne({ ownerId, id }).lean();
    if (!project) throw new NotFoundException('作品不存在或无权访问');
    return project;
  }
  candidateView(c: any): DramaCandidate { return { id: c.id, projectId: c.projectId, kind: c.kind, targetId: c.targetId, status: c.status, source: c.source, workflowOrigin: c.workflowOrigin,
    url: c.url, text: c.text, error: candidateError(c.error), taskId: c.taskId, createdAt: c.createdAt, inputFingerprint: c.inputFingerprint, renderSource: c.renderSource, references: c.references, manualReferenceCount: c.manualReferenceCount, archiveStatus: c.archiveStatus, archiveError: c.archiveError }; }
  async view(project: ShortDramaProject & { updatedAt?: Date }) {
    const items = await this.candidates.find({ projectId: project.id, ownerId: project.ownerId }).sort({ createdAt: 1 }).lean();
    const pending = await this.quotes.find({ projectId: project.id, ownerId: project.ownerId, status: 'submitting' }).select('id kind items').lean();
    return { id: project.id, revision: project.revision, plan: project.plan, stageTemplates: project.stageTemplates || [], updatedAt: project.updatedAt, budget: budgetSummary(project), archived: project.archived, history: (project.history || []).map(h => ({ revision: h.revision, savedAt: h.savedAt })), pendingRequests: pending.map(q => ({ id: q.id, kind: q.kind, count: q.items.length })), candidates: items.map(c => ({ ...this.candidateView(c), stale: !!c.inputFingerprint && c.kind !== 'export' && c.inputFingerprint !== dramaFingerprint(project.plan, c.kind, c.targetId) })) };
  }
  async create(ownerId: string, input?: unknown, templateSource?: { id: string; version: number }) {
    if (process.env.DRAMA_CREATE_ENABLED === 'false') throw new ServiceUnavailableException('新建短剧暂时暂停，已有作品仍可查看和下载');
    const plan = input ? this.normalize(input) : emptyDramaPlan();
    validateSelections(plan, []);
    return this.view(await this.projects.create({ id: randomUUID(), ownerId, revision: 0, plan, ...(templateSource ? { templateSource } : {}) }));
  }
  async list(ownerId: string, page = 1, archived = false, search = '') {
    const filter = { ownerId, archived: archived ? true : { $ne: true }, ...(search ? { 'plan.title': { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}) };
    const [items, total] = await Promise.all([this.projects.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * 24).limit(24).lean(), this.projects.countDocuments(filter)]);
    return { items: await Promise.all(items.map(x => this.view(x))), total, page, pageSize: 24 };
  }
  async get(ownerId: string, id: string) { await this.find(ownerId, id); await this.refresh(ownerId, id); await this.reconcileBudget(ownerId, id); return this.view(await this.find(ownerId, id)); }
  normalize(input: unknown) { try { return normalizeDramaPlan(input); } catch (e) { throw new BadRequestException((e as Error).message); } }
  async update(ownerId: string, id: string, revision: number, input: unknown, stageSource?: { id: string; version: number; stage: string }) {
    const previous = await this.find(ownerId, id), before = this.normalize(previous.plan), plan = this.normalize(input);
    // Upstream edits invalidate confirmations; successful results remain selectable and recoverable.
    if (before.story !== plan.story || before.style !== plan.style) { plan.storyConfirmed = false; plan.castConfirmed = false; plan.storyboardConfirmed = false; }
    // BSON can round-trip undefined as null; compare normalized optional references so
    // saving a keyframe or selecting a video does not revoke unchanged cast approval.
    if (JSON.stringify(roleInputs(before)) !== JSON.stringify(roleInputs(plan))) { plan.castConfirmed = false; plan.storyboardConfirmed = false; }
    if ((before.frame?.ratio || '9:16') !== (plan.frame?.ratio || '9:16')) plan.storyboardConfirmed = false;
    if (JSON.stringify(before.shots.map(s => [s.id, s.description, s.duration, s.image, s.characterIds, s.sceneId])) !== JSON.stringify(plan.shots.map(s => [s.id, s.description, s.duration, s.image, s.characterIds, s.sceneId]))) plan.storyboardConfirmed = false;
    const candidates = await this.candidates.find({ ownerId, projectId: id }).lean();
    try { validateSelections(plan, candidates as DramaCandidate[]); } catch (e) { throw new BadRequestException((e as Error).message); }
    const saved = await this.projects.findOneAndUpdate({ ownerId, id, revision, ...(stageSource ? { archived: { $ne: true } } : {}) }, { $set: { plan }, $inc: { revision: 1 }, $push: { history: { $each: [{ revision, plan: before, savedAt: new Date() }], $slice: -20 }, ...(stageSource ? { stageTemplates: { $each: [{ ...stageSource, appliedAt: new Date(), revision: revision + 1 }], $slice: -50 } } : {}) } }, { new: true }).lean();
    if (!saved) throw new ConflictException({ code: 'DRAMA_REVISION_CONFLICT', message: '作品已在其他窗口更新。你的编辑已保留在本机，请先比较最新版本。' });
    return this.view(saved);
  }
  async catalog() {
    const items = await this.models.find({ disabled: { $ne: true }, model_type: { $in: [...new Set(Object.values(DRAMA_MODEL_TYPES).flat())] } }).sort({ sort: 1, _id: 1 }).lean();
    return items.map(c => ({ configId: String(c._id), modelId: c.model_id, name: c.model_name || c.model_id, type: c.model_type, provider: c.provider,
      kinds: Object.entries(DRAMA_MODEL_TYPES).filter(([, types]) => types.includes(c.model_type)).map(([kind]) => kind),
      params: Object.entries(c.params || {}).filter(([, d]) => !d.hide).map(([name, d]) => ({ name, ...d })) }));
  }
  async voices(ownerId: string, configId: string, page = 1) {
    if (!/^[a-f\d]{24}$/i.test(configId)) throw new BadRequestException('模型配置 ID 不正确');
    const config = await this.models.findOne({ _id: configId, disabled: { $ne: true }, provider: 'akool-openapi', model_type: 'tts' }).lean();
    if (!config || !this.openapi) throw new BadRequestException('当前配音配置不可用，请联系管理员配置 TTS 模型');
    await this.policy.assertNodesAllowed(ownerId, [{ id: 'voice-list', type: 'model', position: { x: 0, y: 0 }, data: { modelId: config.model_id } }]);
    try { return await this.openapi.voices(page); }
    catch (e: any) { throw new BadRequestException(e?.isAxiosError ? '音色读取失败，请管理员检查 akool-openapi 账号池与权限' : e.message); }
  }
  private async billingKey(ownerId: string) {
    return this.keys.ensureExecutionBillingKey(ownerId);
  }
  private assertStage(plan: DramaPlan, kind: DramaKind) {
    if (!plan.story.trim()) throw new BadRequestException('先写下你要讲的故事');
    if (kind !== 'script' && !plan.storyConfirmed) throw new BadRequestException('先确认故事，再制作素材');
    if (['image', 'video', 'voice'].includes(kind) && !plan.castConfirmed) throw new BadRequestException('先确认角色与场景设定');
    if (kind === 'video' && !plan.storyboardConfirmed) throw new BadRequestException('先检查分镜并选好画面');
  }
  async quote(ownerId: string, id: string, kind: DramaKind, targetIds: string[], configId?: string, overrides: Record<string, unknown> = {}) {
    this.assertGenerationEnabled();
    if (configId && !/^[a-f\d]{24}$/i.test(configId)) throw new BadRequestException('模型配置 ID 不正确');
    const project = await this.find(ownerId, id); this.assertStage(project.plan, kind);
    if (project.archived) throw new BadRequestException('请先恢复已归档作品再制作');
    configId ||= project.plan.production?.models?.[kind];
    if (kind === 'voice' && configId && configId === project.plan.production?.models?.voice) overrides = { ...project.plan.production?.voiceParameters, ...overrides };
    const types = DRAMA_MODEL_TYPES[kind]; if (!types) throw new BadRequestException('不支持的生成类型');
    const unique = [...new Set(targetIds)]; if (!unique.length || unique.length > 12) throw new BadRequestException('每次请选择 1–12 项制作');
    if (['script', 'music'].includes(kind) && (unique.length !== 1 || unique[0] !== 'project')) throw new BadRequestException('生成目标不正确');
    const provider = project.plan.production?.providers?.[kind] || project.plan.production?.provider;
    const configs = await this.models.find({ disabled: { $ne: true }, model_type: { $in: types }, ...(configId ? { _id: configId } : {}), ...(provider ? { provider } : {}) }).sort({ sort: 1, _id: 1 }).lean();
    if (!configs.length) throw new BadRequestException('当前没有可用的模型配置，请联系管理员启用对应能力，或先上传自己的素材');
    if (!configId && ['image','video'].includes(kind)) {
      const coverage = (cfg: ModelConfig) => unique.reduce((sum,targetId)=>sum+referenceUsage(shotReferences(project.plan,kind,targetId),Object.entries(cfg.params || {}).map(([name,def])=>({name,...def}))).used.length,0);
      configs.sort((a,b)=>coverage(b)-coverage(a));
    }
    const candidates = await this.candidates.find({ ownerId, projectId: id }).lean();
    const errors: string[] = [];
    for (const cfg of configs) {
      try {
        await this.policy.assertNodesAllowed(ownerId, [{ id: 'drama', type: 'model', position: { x: 0, y: 0 }, data: { modelId: cfg.model_id } }]);
        let estimatedCostMicros = 0;
        const voiceChecks = new Map<string, Promise<unknown>>();
        const items = await Promise.all(unique.map(async targetId => {
          const input: Record<string, any> = {};
          for (const [name, def] of Object.entries(cfg.params || {})) if (def.default !== undefined) input[name] = def.default;
          for (const [name, value] of Object.entries(overrides)) if (cfg.params?.[name] && !cfg.params[name].hide) input[name] = value;
          const prompt = dramaPrompt(project.plan, kind, targetId);
          const promptField = kind === 'voice' && cfg.params?.text ? 'text' : cfg.params?.prompt ? 'prompt' : cfg.params?.text ? 'text' : 'prompt';
          input[promptField] = prompt;
          const shot = project.plan.shots.find(s => s.id === targetId);
          if (cfg.params?.duration && overrides.duration === undefined) {
            const duration = shot?.duration || project.plan.duration; const def = cfg.params.duration;
            input.duration = generationDuration(duration,def);
          }
          if (['character', 'scene', 'image', 'video'].includes(kind)) applyFrameInput(input, cfg.params || {}, project.plan, overrides);
          const reference = applyShotReferences(project.plan, kind, targetId, candidates as DramaCandidate[], Object.entries(cfg.params || {}).map(([name, def]) => ({ name, ...def })), input);
          const validation = validateParams(input, cfg.params || {}, cfg.params_rules);
          if (!validation.valid) throw new Error(validation.errors.map(x => `${x.field}: ${x.message}`).join('；'));
          if (kind === 'voice' && cfg.provider === 'akool-openapi') {
            if (!this.openapi) throw new Error('配音供应商未就绪');
            const key = JSON.stringify([validation.sanitized.voice_id, validation.sanitized.voice_model_name]);
            if (!voiceChecks.has(key)) voiceChecks.set(key, this.openapi.validateVoice(validation.sanitized));
            await voiceChecks.get(key);
          }
          const cost = estimateModelPrice(cfg, validation.sanitized);
          if (!Number.isFinite(cost.estimatedCost) || cost.unitPrice <= 0) throw new Error('模型未配置有效积分价格');
          const ceilingMicros = Math.ceil(cost.estimatedCost * 1e6);
          estimatedCostMicros += ceilingMicros;
          return { id: randomUUID(), targetId, input: validation.sanitized, fingerprint: dramaFingerprint(project.plan, kind, targetId), ceiling: ceilingMicros / 1e6, ...(['image','video'].includes(kind) ? {references:reference.used,omittedReferences:reference.omitted,manualReferenceCount:reference.manualReferenceCount} : {}) };
        }));
        const quote = await this.quotes.create({ id: randomUUID(), ownerId, projectId: id, revision: project.revision, kind,
          items, estimatedCost: estimatedCostMicros / 1e6, expiresAt: new Date(Date.now() + 5 * 60 * 1000), status: 'quoted',
          model: { id: String(cfg._id), modelId: cfg.model_id, revision: cfg.revision, name: cfg.model_name || cfg.model_id, type: cfg.model_type, fingerprint: configFingerprint(cfg), outputSchema: cfg.output_schema } });
        return { id: quote.id, kind, count: items.length, estimatedCost: quote.estimatedCost, currency: 'credit', expiresAt: quote.expiresAt, modelName: quote.model.name, provider: cfg.provider,
          items:items.map(item=>{const shot=project.plan.shots.find(s=>s.id===item.targetId);return {targetId:item.targetId,title:shot?.title || item.targetId,references:item.references,omittedReferences:item.omittedReferences,manualReferenceCount:item.manualReferenceCount,...(kind==='video' ? {duration:Number(item.input.duration) || undefined,requestedDuration:shot?.duration} : {})};}),
          warnings: ['本次报价也是本批授权扣费上限；失败退款以任务结算状态为准。', ...(['character','scene','image','video'].includes(kind) ? [`作品画幅 ${project.plan.frame?.ratio || '9:16'}。${cfg.params?.aspect_ratio || cfg.params?.width && cfg.params?.height ? '已按模型尺寸能力检查；上游返回后仍需检查实际画幅。' : cfg.model_type==='imageToVideo' ? '此模型没有独立画幅参数，通常跟随参考图；请先检查所选图片。' : '此模型未声明可控画幅，返回尺寸可能不同，请检查后选用。'}`,'角色一致性取决于模型能力，请逐镜头检查后再选用。'] : [])] };
      } catch (error) { errors.push(`${cfg.model_name || cfg.model_id}：${(error as Error).message}`); }
    }
    throw new BadRequestException({ code: 'DRAMA_PREFLIGHT_FAILED', message: `生成前检查未通过。${errors.slice(0, 2).join('；')}。${kind === 'voice' ? '本次未提交配音生成，请按提示重试、重新选择音色或检查配音配置。' : '可展开“更多设置”补充必填项或切换模型。'}` });
  }
  async confirm(ownerId: string, id: string, quoteId: string) {
    const project = await this.find(ownerId, id);
    const previous = await this.quotes.findOne({ ownerId, projectId: id, id: quoteId }).lean();
    if (!previous) throw new NotFoundException('报价不存在');
    if (previous.status === 'complete') return this.get(ownerId, id);
    this.assertGenerationEnabled();
    if (project.archived) throw new BadRequestException('请先恢复已归档作品再制作');
    if (previous.status === 'quoted' && (previous.expiresAt.getTime() <= Date.now() || project.revision !== previous.revision)) throw new ConflictException('报价已过期或作品已修改，请重新查看消耗');
    const config = await this.models.findOne({ _id: previous.model.id, disabled: { $ne: true } }).lean();
    if (!config || configFingerprint(config) !== previous.model.fingerprint) {
      if (previous.status === 'submitting') {
        // A missing response does not prove no paid task exists. Keep its hold until reconciled.
        throw new ConflictException('模型配置已更新，之前的提交结果尚待核实。预算预留已保留，请联系管理员核实请求，避免重复制作');
      }
      throw new ConflictException('模型配置或价格已更新，请重新查看消耗');
    }
    const key = await this.billingKey(ownerId);
    const quote = await this.quotes.findOneAndUpdate({ ownerId, projectId: id, id: quoteId, $or: [{ status: 'quoted' }, { status: 'submitting', leaseUntil: { $lt: new Date() } }] },
      { $set: { status: 'submitting', leaseUntil: new Date(Date.now() + 5 * 60 * 1000) } }, { new: true }).lean();
    if (!quote) throw new ConflictException('这次请求正在提交，请稍后刷新，避免重复制作');
    try {
      const reserved = await this.projects.updateOne({ ownerId, id, 'budgetHolds.quoteId': { $ne: quoteId },
        $expr: { $lte: [{ $add: [{ $sum: { $ifNull: ['$budgetHolds.amount', []] } }, quote.estimatedCost] }, { $ifNull: ['$budgetLimit', 0] }] } },
        { $push: { budgetHolds: { quoteId, amount: quote.estimatedCost, settled: false } } });
      if (!reserved.modifiedCount && !(await this.find(ownerId, id)).budgetHolds?.some(h => h.quoteId === quoteId)) {
        await this.quotes.updateOne({ id: quoteId }, { $set: { status: 'quoted' } });
        throw new BadRequestException('项目剩余预算不足。请减少本批范围或调整项目预算后重新确认');
      }
      for (const item of quote.items) {
        await this.quotes.updateOne({ id: quoteId }, { $set: { leaseUntil: new Date(Date.now() + 5 * 60 * 1000) } });
        await this.candidates.updateOne({ id: item.id }, { $setOnInsert: { id: item.id, ownerId, projectId: id, kind: quote.kind, targetId: item.targetId, source: 'model', status: 'pending', billingKey: key, outputSchema: quote.model.outputSchema, inputFingerprint: item.fingerprint, ...(item.references ? {references:item.references,manualReferenceCount:item.manualReferenceCount} : {}) } }, { upsert: true });
        const existing = await this.candidates.findOne({ id: item.id }).select('+billingKey').lean();
        if (existing?.taskId || existing?.status === 'failed') continue;
        try {
          // A pre-upgrade or interrupted submission keeps its original wallet and
          // idempotency scope, even if the account now has a different billing binding.
          const task = await this.tasks.createTask(existing?.billingKey || key, { model: quote.model.modelId, input: { ...item.input }, options: { configId: quote.model.id, configRevision: quote.model.revision, featureType: quote.model.type },
            metadata: { dramaProjectId: id, dramaCandidateId: item.id } }, `drama:${quote.id}:${item.id}`, { maxCharge: item.ceiling ?? quote.estimatedCost / quote.items.length });
          await this.candidates.updateOne({ id: item.id }, { $set: { taskId: task.taskId, status: 'running' } });
        } catch (e) {
          // A lost response is ambiguous: leave the quote resumable with the same task idempotency key.
          if (!(e instanceof BadRequestException) && (e as any)?.getStatus?.() !== 402 && (e as any)?.getStatus?.() !== 403) throw e;
          await this.candidates.updateOne({ id: item.id }, { $set: { status: 'failed', completedAt: new Date(), error: candidateError((e as Error).message.slice(0, 500)) } });
        }
      }
      await this.quotes.updateOne({ id: quoteId }, { $set: { status: 'complete' } });
    } catch (e) { await this.quotes.updateOne({ id: quoteId }, { $set: { leaseUntil: new Date(0) } }); throw e; }
    return this.get(ownerId, id);
  }
  private async refresh(ownerId: string, projectId: string) {
    // Retry extraction of already paid successful tasks after an output parser fix.
    // Actual provider failures and cancelled candidates must remain terminal.
    const active = await this.candidates.find({ ownerId, projectId, taskId: { $exists: true }, $or: [
      { status: { $in: ['pending', 'running'] } }, { status: 'failed', error: OUTPUT_FORMAT_ERROR },
    ] }).select('+billingKey +outputSchema').lean();
    await Promise.all(active.map(async c => {
      try {
        const task = await this.tasks.getTask(c.billingKey!, c.taskId!);
        if (task.status === 'SUCCESS') {
          const result = readDramaOutput(task.result, dramaMedia(c.kind), c.outputSchema);
          const succeeded = !!(result.url || result.text);
          await this.candidates.updateOne({ id: c.id, ownerId, projectId, status: c.status, ...(c.status === 'failed' ? { error: OUTPUT_FORMAT_ERROR } : {}) }, {
            $set: { ...result, status: succeeded ? 'succeeded' : 'failed', completedAt: new Date(), ...(!succeeded ? { error: OUTPUT_FORMAT_ERROR } : {}) },
            ...(succeeded ? { $unset: { error: 1 } } : {}),
          });
        } else if (['FAILED', 'TIMEOUT', 'CANCELLED'].includes(task.status)) await this.candidates.updateOne({ id: c.id }, { $set: { status: 'failed', completedAt: new Date(), error: candidateError(task.error?.message || '制作没有完成，可以只重做这一项', task.error?.code) } });
      } catch { /* A query outage must not turn a running task into a failure. */ }
    }));
  }
  @Interval(15000)
  async synchronize() {
    if (this.synchronizing) return;
    this.synchronizing = true;
    try {
      const projects = await this.projects.find({}).sort({ synchronizedAt: 1 }).limit(10).lean();
      for (const p of projects) {
        try { await this.refresh(p.ownerId, p.id); await this.reconcileBudget(p.ownerId, p.id); await this.archiveResults(p.ownerId, p.id); }
        catch { /* Retry durable states on the next synchronization pass. */ }
        await this.projects.updateOne({ id: p.id }, { $set: { synchronizedAt: new Date() } });
      }
    } finally { this.synchronizing = false; }
  }
  assertGenerationEnabled() {
    if (process.env.DRAMA_GENERATION_ENABLED === 'false') throw new ServiceUnavailableException('新生成暂时暂停，已有作品仍可编辑、查看和下载');
  }
  async templates() {
    if (process.env.DRAMA_TEMPLATES_ENABLED === 'false') return [];
    const models = await this.catalog();
    return DRAMA_TEMPLATES.map(t => ({ id: t.id, version: t.version, name: t.name, description: t.description, shotCount: t.shots.length, generatedMedia: false,
      provider: 'akool-maas', missing: ['textToImage', 'imageToVideo', 'tts', 'music'].filter(type => !models.some(m => m.type === type && m.provider === (type === 'tts' ? 'akool-openapi' : 'akool-maas'))) }));
  }
  async fromTemplate(ownerId: string, templateId: string) {
    if (process.env.DRAMA_TEMPLATES_ENABLED === 'false') throw new NotFoundException('项目模板暂未开放');
    let plan = templatePlan(templateId);
    if (!plan && isValidObjectId(templateId) && this.templateSubmissions) {
      const template = await this.templateSubmissions.findOne({ _id: templateId, kind: 'short-drama', status: 'published' }).select('+dramaPlan').lean();
      if (template?.dramaPlan) plan = structuredClone(template.dramaPlan);
    }
    if (!plan) throw new NotFoundException('模板不存在或版本已下架');
    const models = await this.catalog();
    const image = models.find(m => m.provider === 'akool-maas' && m.modelId === 'seedream-4-0/text-to-image' && m.type === 'textToImage');
    const video = models.find(m => m.provider === 'akool-maas' && m.modelId === 'pixverse-v6-max/image-to-video' && m.type === 'imageToVideo');
    if (image) (['character', 'scene', 'image'] as const).forEach(kind => { plan.production!.models[kind] = image.configId; });
    if (video) plan.production!.models.video = video.configId;
    // Fix only unambiguous language capabilities to this new project. No automatic generation.
    for (const [kind, type, provider] of [['script', 'textGenerate', 'akool-maas'], ['voice', 'tts', 'akool-openapi']] as const) {
      const available = models.filter(m => m.type === type && m.provider === provider);
      if (available.length === 1) {
        plan.production!.models[kind] = available[0].configId;
        plan.production!.providers = { ...plan.production!.providers, [kind]: provider };
      }
    }
    return this.create(ownerId, plan, { id: templateId, version: DRAMA_TEMPLATES.find(t => t.id === templateId)?.version || 1 });
  }
  async applyStageTemplate(ownerId: string, id: string, revision: number, templateId: string, stage: 'characters' | 'storyboard') {
    if (process.env.DRAMA_TEMPLATES_ENABLED === 'false') throw new NotFoundException('项目模板暂未开放');
    const project = await this.find(ownerId, id);
    if (project.archived) throw new BadRequestException('请先恢复作品，再应用模板');
    if (project.revision !== revision) throw new ConflictException('作品已更新，请刷新后重试');
    let source = templatePlan(templateId), version = DRAMA_TEMPLATES.find(t => t.id === templateId)?.version || 1;
    if (!source && isValidObjectId(templateId) && this.templateSubmissions) source = (await this.templateSubmissions.findOne({ _id: templateId, kind: 'short-drama', status: 'published' }).select('+dramaPlan').lean())?.dramaPlan;
    if (!source) throw new NotFoundException('模板不存在或已下架');
    if (stage === 'characters' && !source.characters.length || stage === 'storyboard' && !source.shots.length) throw new BadRequestException('模板没有该阶段内容');
    let plan: DramaPlan;
    try { plan = appendDramaStage(project.plan, source, stage); } catch (error) { throw new BadRequestException(`无法追加模板：${(error as Error).message}`); }
    return this.update(ownerId, id, revision, plan, { id: templateId, version, stage });
  }
  async setBudget(ownerId: string, id: string, revision: number, limit: number) {
    const updated = await this.projects.findOneAndUpdate({ ownerId, id, revision,
      $expr: { $lte: [{ $sum: { $ifNull: ['$budgetHolds.amount', []] } }, limit] } }, { $set: { budgetLimit: limit }, $inc: { revision: 1 } }, { new: true }).lean();
    if (!updated) throw new ConflictException('预算不能低于已用和预留金额，或作品已更新。请刷新后重试');
    return this.view(updated);
  }
  async reconcileBudget(ownerId: string, projectId: string) {
    await this.workflowBudget?.reconcile(ownerId, projectId);
    const project = await this.find(ownerId, projectId);
    const quotes = await this.quotes.find({ ownerId, projectId, status: 'complete' }).lean();
    for (const q of quotes) {
      const hold = project.budgetHolds?.find(h => h.quoteId === q.id);
      if (hold?.settled) continue;
      const candidates = await this.candidates.find({ ownerId, projectId, id: { $in: q.items.map(i => i.id) } }).select('+billingKey').lean();
      if (candidates.length !== q.items.length) continue;
      let amount = 0, complete = true;
      for (const c of candidates) {
        if (!c.taskId) { if (c.status !== 'failed') complete = false; continue; }
        try {
          const task = await this.tasks.getTask(c.billingKey!, c.taskId);
          if (task.billing?.status === 'settled') amount += task.billing.actualCost || 0;
          else if (task.billing?.status !== 'refunded') complete = false;
        } catch { complete = false; }
      }
      if (!complete) continue;
      amount = Math.round(amount * 1e6) / 1e6;
      if (hold) await this.projects.updateOne({ ownerId, id: projectId, budgetHolds: { $elemMatch: { quoteId: q.id, settled: false } } },
        { $set: { 'budgetHolds.$.amount': amount, 'budgetHolds.$.settled': true } });
      else await this.projects.updateOne({ ownerId, id: projectId, 'budgetHolds.quoteId': { $ne: q.id } }, { $push: { budgetHolds: { quoteId: q.id, amount, settled: true } } });
    }
  }
  private async archiveResults(ownerId: string, projectId: string) {
    if (!this.assetStorage) return;
    const items = await this.candidates.find({ ownerId, projectId, source: { $in: ['model', 'workflow'] }, kind: { $ne: 'script' }, status: 'succeeded', url: { $exists: true }, archiveStatus: { $ne: 'archived' },
      $or: [{ archiveLeaseUntil: { $exists: false } }, { archiveLeaseUntil: { $lt: new Date() } }] }).limit(3).lean();
    for (const c of items) {
      const claimed = await this.candidates.updateOne({ id: c.id, archiveStatus: { $ne: 'archived' }, $or: [{ archiveLeaseUntil: { $exists: false } }, { archiveLeaseUntil: { $lt: new Date() } }] },
        { $set: { archiveStatus: 'archiving', archiveLeaseUntil: new Date(Date.now() + 180000) } });
      if (!claimed.modifiedCount) continue;
      try {
        const buffer = await downloadDramaMedia(c.url!);
        const media = dramaMedia(c.kind);
        if (media === 'text') continue;
        const mime = dramaMediaMime(buffer, media);
        const asset = await this.assetStorage.upload(ownerId, { buffer, mimetype: mime, originalname: `${c.kind}-${c.id}.${mime.split('/')[1]}` }, 'drama-archive');
        await this.candidates.updateOne({ id: c.id }, { $set: { url: asset.url, assetId: asset.id, archiveStatus: 'archived' }, $unset: { archiveError: 1, archiveLeaseUntil: 1 } });
      } catch {
        await this.candidates.updateOne({ id: c.id }, { $set: { archiveStatus: 'failed', archiveError: '素材归档尚未完成，源结果已保留。稍后可重试；归档前请勿依赖长期链接。', archiveLeaseUntil: new Date(Date.now() + 300000) } });
      }
    }
  }
  async retryArchives(ownerId: string, id: string) {
    const project = await this.find(ownerId, id);
    await this.candidates.updateMany({ ownerId, projectId: id, archiveStatus: 'failed' }, { $set: { archiveLeaseUntil: new Date(0) } });
    // The durable background synchronizer owns downloads; this action never creates model tasks.
    return this.view(project);
  }
  async media(ownerId: string, id: string, candidateId: string) {
    await this.find(ownerId, id);
    const c = await this.candidates.findOne({ ownerId, projectId: id, id: candidateId, status: 'succeeded' }).lean();
    const media = c && dramaMedia(c.kind);
    if (!c?.url || !media || media === 'text') throw new NotFoundException('素材尚未就绪');
    const data = await downloadDramaMedia(c.url);
    try { return { data, type: dramaMediaMime(data, media) }; }
    catch { throw new BadRequestException('素材内容不是支持的媒体文件，请重新上传或检查供应商结果'); }
  }
  async copy(ownerId: string, id: string) {
    const p = await this.find(ownerId, id), plan = structuredClone(p.plan);
    plan.title = `${plan.title.slice(0, 90)}（副本）`; plan.step = 0; plan.storyConfirmed = false; plan.castConfirmed = false; plan.storyboardConfirmed = false;
    plan.characters.forEach(r => delete r.selected); plan.scenes.forEach(r => delete r.selected);
    plan.shots.forEach(s => { delete s.image; delete s.video; delete s.voice; }); delete plan.settings.music;
    return this.create(ownerId, plan);
  }
  async archive(ownerId: string, id: string, revision: number, archived: boolean) {
    const p = await this.projects.findOneAndUpdate({ ownerId, id, revision }, { $set: { archived }, $inc: { revision: 1 } }, { new: true }).lean();
    if (!p) throw new ConflictException('作品已更新，请刷新后重试');
    return this.view(p);
  }
  async restore(ownerId: string, id: string, revision: number, target: number) {
    const p = await this.find(ownerId, id), h = p.history?.find(h => h.revision === target);
    if (!h) throw new NotFoundException('历史版本已不存在');
    return this.update(ownerId, id, revision, h.plan);
  }
  async attach(ownerId: string, id: string, kind: DramaKind, targetId: string, assetId: string) {
    const project = await this.find(ownerId, id);
    if (['script', 'export'].includes(kind)) throw new BadRequestException('此步骤不支持素材导入');
    if (kind === 'music' && targetId !== 'project') throw new BadRequestException('配乐目标不正确');
    dramaPrompt(project.plan, kind, targetId);
    const asset = await this.assets.findOne({ id: assetId, ownerId }).lean();
    if (!asset || asset.kind !== dramaMedia(kind)) throw new BadRequestException('素材不存在或类型不匹配');
    const candidate = await this.candidates.create({ id: randomUUID(), ownerId, projectId: id, kind, targetId, source: 'upload', status: 'succeeded', url: asset.url, inputFingerprint: dramaFingerprint(project.plan, kind, targetId) });
    return this.candidateView(candidate);
  }
  async cancel(ownerId: string, id: string, candidateId: string) {
    await this.find(ownerId, id);
    const c = await this.candidates.findOne({ id: candidateId, ownerId, projectId: id }).select('+billingKey').lean();
    if (!c?.taskId) throw new BadRequestException('这项没有可以取消的模型任务');
    await this.tasks.cancelTask(c.billingKey!, c.taskId, `drama:${id}`);
    await this.candidates.updateOne({ id: c.id }, { $set: { status: 'failed', completedAt: new Date(), error: '已取消，可重新制作' } });
    return this.get(ownerId, id);
  }
}
