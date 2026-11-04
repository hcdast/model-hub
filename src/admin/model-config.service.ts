import { randomUUID } from 'crypto';
import { mapModelImport, configDiff } from './utils/model-import';
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { ModelRoutingRule, ModelRoutingRuleDocument } from '../database/schemas/model-routing-rule.schema';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { TERMINAL_STATUSES } from '../common/constants/task-status';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ValidationResult, UniquenessCheckResult, ConflictInfo } from './interfaces/validation.interface';
import { ModelConfigValidator } from './utils/model-config-validator';
import { validateParamDefinitions } from '../common/utils/param-definition-validator';
import { sanitizeParamDefinitions } from '../common/utils/param-definitions-sanitize';
import { MODEL_CONFIG_FIELDS, pickModelConfig, validateModelContract } from '../common/utils/model-contract';
import { languageModelPreset, voiceModelPreset } from './model-config-presets';

/**
 * 模型配置服务
 * 负责模型配置的业务逻辑处理
 */
@Injectable()
export class ModelConfigService {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
    @InjectModel(ModelRoutingRule.name)
    private readonly routingModel?: Model<ModelRoutingRuleDocument>,
    @InjectModel(Task.name)
    private readonly taskModel?: Model<TaskDocument>,
  ) {}

  async deleteConfig(id: string, expectedRevision: number) {
    if (!isValidObjectId(id)) throw new BadRequestException('模型配置 ID 无效');
    const current = await this.modelConfigModel.findById(id).lean();
    if (!current) throw new NotFoundException('模型配置不存在');
    this.assertRevision(current.revision, expectedRevision);
    const [routes, tasks] = await Promise.all([
      this.routingModel!.countDocuments({ model_id: current.model_id, $or: [
        { fixed_provider: current.provider }, { primary_provider: current.provider }, { fallback_provider: current.provider },
        { 'weighted_targets.provider': current.provider }, { latency_targets: current.provider }, { 'cost_targets.provider': current.provider },
      ] }),
      this.taskModel!.countDocuments({ model: current.model_id, provider: current.provider, status: { $nin: [...TERMINAL_STATUSES] } }),
    ]);
    if (routes || tasks) throw new ConflictException(`无法删除：仍关联 ${routes} 条路由、${tasks} 个未结束任务，请先处理关联数据`);
    const deleted = await this.modelConfigModel.findOneAndDelete(this.revisionFilter(id, expectedRevision));
    if (!deleted) throw new ConflictException('配置已被修改，请重新加载');
    return { id, model_id: current.model_id, deleted: true };
  }

  async bulkDelete(items: Array<{ id: string; expected_revision: number }>) {
    if (!Array.isArray(items) || !items.length || items.length > 100) throw new BadRequestException('请选择 1 至 100 条模型');
    if (items.some(item => !item || !isValidObjectId(item.id) || !Number.isSafeInteger(item.expected_revision) || item.expected_revision < 0)) {
      throw new BadRequestException('模型 ID 或版本号无效');
    }
    if (new Set(items.map(item => item.id)).size !== items.length) throw new BadRequestException('不能重复选择同一模型');
    const results: Array<{ id: string; status: 'success' | 'failed'; error?: string }> = [];
    for (const item of items) {
      try {
        await this.deleteConfig(item.id, item.expected_revision);
        results.push({ id: item.id, status: 'success' });
      } catch (error: any) {
        results.push({ id: item.id, status: 'failed', error: error.message });
      }
    }
    return { results };
  }

  private readonly importPlans = new Map<string, { actor: string; expires: number; rows: any[] }>();

  async previewImport(body: { source: any; maasOnly?: boolean; duplicate?: string }, actor: string) {
    if (!['skip', 'preserve', 'replace'].includes(body.duplicate || 'preserve')) throw new BadRequestException('重复策略无效');
    const mapped = mapModelImport(body.source, body.maasOnly !== false);
    const rows: any[] = [], seen = new Set<string>();
    for (const row of mapped.rows) {
      const existing = await this.modelConfigModel.findOne({ provider_model_name: row.config.provider_model_name }).lean();
      if (seen.has(row.config.provider_model_name)) row.errors.push('文件内厂商模型名称重复');
      seen.add(row.config.provider_model_name);
      let config = row.config;
      if (existing && body.duplicate !== 'replace') {
        config = { ...pickModelConfig(existing), ...config, model_id: existing.model_id, disabled: existing.disabled, unit_price_map: existing.unit_price_map, pricing: existing.pricing };
        row.warnings.push('保留现有启停和价格；系统专有字段不会被覆盖');
      }
      const action = existing && body.duplicate === 'skip' ? 'skip' : existing ? 'update' : 'create';
      const validation = this.validateConfig(config);
      rows.push({ ...row, config, action, id: existing?._id?.toString(), expected_revision: existing?.revision || 0,
        errors: [...row.errors, ...validation.errors.map(e => `${e.field}: ${e.message}`)],
        diff: configDiff(existing ? pickModelConfig(existing) : {}, config) });
    }
    for (const [id, plan] of this.importPlans) if (plan.expires < Date.now()) this.importPlans.delete(id);
    if (this.importPlans.size >= 30) throw new BadRequestException('预览过多，请稍后重试');
    const planId = randomUUID();
    this.importPlans.set(planId, { actor, expires: Date.now() + 600000, rows });
    return { planId, expiresAt: new Date(Date.now() + 600000).toISOString(), excluded: mapped.excluded, rows };
  }

  async commitImport(planId: string, actor: string) {
    const plan = this.importPlans.get(planId);
    if (!plan || plan.actor !== actor || plan.expires < Date.now()) throw new BadRequestException('导入预览已失效，请重新预览');
    this.importPlans.delete(planId);
    const results: any[] = [];
    for (const row of plan.rows) {
      try {
        if (row.action === 'skip') { results.push({ model_id: row.config.model_id, status: 'skipped' }); continue; }
        if (row.errors.length) throw new BadRequestException(row.errors.join('；'));
        const saved = row.action === 'create' ? await this.createConfig(row.config as CreateModelConfigDto, actor)
          : await this.updateConfig(row.id, { ...row.config, expected_revision: row.expected_revision }, actor);
        results.push({ model_id: row.config.model_id, status: 'success', id: (saved as any)._id });
      } catch (error: any) { results.push({ model_id: row.config.model_id, status: 'failed', error: error.message }); }
    }
    return { results, success: results.filter(r => r.status === 'success').length, failed: results.filter(r => r.status === 'failed').length };
  }

  async bulkUpdate(items: Array<{ id: string; expected_revision: number }>, patch: Record<string, any>, actor: string) {
    if (!Array.isArray(items) || !items.length || items.length > 100) throw new BadRequestException('请选择 1 至 100 条模型');
    const keys = Object.keys(patch || {});
    if (!keys.length || keys.some(k => !['disabled', 'unit_price_map'].includes(k))) throw new BadRequestException('批量操作只支持启停或完整价格表');
    const results: any[] = [];
    for (const item of items) {
      try {
        this.assertRevision(item.expected_revision, item.expected_revision);
        await this.updateConfig(item.id, { ...patch, expected_revision: item.expected_revision }, actor);
        results.push({ id: item.id, status: 'success' });
      } catch (error: any) { results.push({ id: item.id, status: 'failed', error: error.message }); }
    }
    return { results };
  }

  /**
   * 验证配置数据
   * @param config 配置对象
   * @returns 验证结果
   */
  validateConfig(config: Partial<ModelConfig>): ValidationResult {
    const result = ModelConfigValidator.validateConfig(config as Record<string, any>);
    result.errors.push(...validateModelContract(config).map(message => ({ field: 'contract', message })));
    return { ...result, valid: result.errors.length === 0 };
  }

  /**
   * 检查唯一性约束
   * @param config 配置对象
   * @param excludeId 排除的配置 ID（用于更新时排除自身）
   * @returns 唯一性检查结果
   */
  async checkUniqueness(
    config: Partial<ModelConfig>,
    excludeId?: string,
  ): Promise<UniquenessCheckResult> {
    const conflicts: ConflictInfo[] = [];

    // model_id 可与多条 provider_model_name 对应；仅以 provider_model_name 唯一
    if (config.provider_model_name) {
      const query: any = {
        provider_model_name: config.provider_model_name,
      };

      // 更新时排除自身
      if (excludeId) {
        query._id = { $ne: excludeId };
      }

      const existing = await this.modelConfigModel.findOne(query).lean();
      if (existing) {
        conflicts.push({
          field: 'provider_model_name',
          value: config.provider_model_name,
          existingModelName: existing.model_id,
        });
      }
    }

    return {
      unique: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * 创建配置
   * @param dto 创建配置 DTO
   * @param userId 操作用户 ID
   * @returns 创建的配置
   */
  async createConfig(dto: CreateModelConfigDto, userId: string): Promise<ModelConfig> {
    const dtoIn = {
      ...pickModelConfig(dto),
      params: dto.params ? sanitizeParamDefinitions(dto.params) : dto.params,
    };

    // 验证配置数据
    const validationResult = this.validateConfig(dtoIn);
    if (!validationResult.valid) {
      throw new Error(`数据验证失败: ${JSON.stringify(validationResult.errors)}`);
    }

    // 校验 params 参数定义结构
    if (dtoIn.params && Object.keys(dtoIn.params).length > 0) {
      const paramDefResult = validateParamDefinitions(dtoIn.params);
      if (!paramDefResult.valid) {
        throw new Error(`参数定义校验失败: ${JSON.stringify(paramDefResult.errors)}`);
      }
    }

    // 检查唯一性
    const uniquenessResult = await this.checkUniqueness(dtoIn);
    if (!uniquenessResult.unique) {
      throw new Error(`配置已存在: ${JSON.stringify(uniquenessResult.conflicts)}`);
    }

    // 创建配置
    const now = Date.now();
    const config = new this.modelConfigModel({
      ...dtoIn,
      create_time: now,
      update_time: now,
    });

    return config.save();
  }

  /**
   * 更新配置
   * @param id 配置 ID
   * @param dto 更新配置 DTO
   * @param userId 操作用户 ID
   * @returns 更新后的配置
   */
  async updateConfig(id: string, dto: UpdateModelConfigDto, userId: string): Promise<ModelConfig> {
    // 查找现有配置
    const existing = await this.modelConfigModel.findById(id);
    if (!existing) {
      throw new Error('模型配置不存在');
    }

    if (dto.expected_revision !== undefined) this.assertRevision(existing.revision, dto.expected_revision);

    // 合并配置数据（params 写入前去掉废弃字段与错配约束）
    const dtoSanitized = {
      ...pickModelConfig(dto),
      ...(dto.params !== undefined ? { params: sanitizeParamDefinitions(dto.params) } : {}),
    };
    const mergedConfig = { ...existing.toObject(), ...dtoSanitized };

    // 验证配置数据
    const validationResult = this.validateConfig(mergedConfig);
    if (!validationResult.valid) {
      throw new Error(`数据验证失败: ${JSON.stringify(validationResult.errors)}`);
    }

    // 校验 params 参数定义结构
    const paramsToValidate = dtoSanitized.params ?? mergedConfig.params;
    if (paramsToValidate && Object.keys(paramsToValidate).length > 0) {
      const paramDefResult = validateParamDefinitions(paramsToValidate);
      if (!paramDefResult.valid) {
        throw new Error(`参数定义校验失败: ${JSON.stringify(paramDefResult.errors)}`);
      }
    }

    // 检查唯一性（排除自身）
    const uniquenessResult = await this.checkUniqueness(mergedConfig, id);
    if (!uniquenessResult.unique) {
      throw new Error(`配置已存在: ${JSON.stringify(uniquenessResult.conflicts)}`);
    }

    // 更新配置
    const updated = await this.modelConfigModel.findOneAndUpdate(
      this.revisionFilter(id, existing.revision || 0),
      {
        $set: {
          ...dtoSanitized,
          update_time: Date.now(),
        },
        $inc: { revision: 1 },
        $push: { history: { $each: [{ revision: existing.revision || 0, config: pickModelConfig(existing.toObject()), saved_at: Date.now() }], $slice: -20 } },
      },
      { new: true },
    );

    if (!updated) {
      throw new ConflictException('配置已被修改，请重新加载');
    }

    return updated;
  }

  async saveDraft(id: string, config: Record<string, any>, expectedRevision: number, expectedDraftRevision = 0) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new BadRequestException('config 必须为配置对象');
    const current = await this.modelConfigModel.findById(id).lean();
    if (!current) throw new NotFoundException('模型配置不存在');
    const draft = { ...pickModelConfig(current), ...pickModelConfig(config), contract_version: 2 };
    this.assertRevision(current.revision, expectedRevision);
    this.assertRevision(current.draft_revision, expectedDraftRevision);
    this.assertValid(draft);
    const result = await this.modelConfigModel.findOneAndUpdate(this.draftRevisionFilter(id, expectedRevision, expectedDraftRevision), { $set: { draft, update_time: Date.now() }, $inc: { draft_revision: 1 } }, { new: true });
    if (!result) throw new ConflictException('配置已被修改，请重新加载');
    return result;
  }

  async publish(id: string, expectedRevision: number, rollback = false, expectedDraftRevision = 0, targetRevision?: number) {
    const current = await this.modelConfigModel.findById(id).lean();
    if (!current) throw new NotFoundException('模型配置不存在');
    this.assertRevision(current.revision, expectedRevision);
    this.assertRevision(current.draft_revision, expectedDraftRevision);
    const next = rollback ? (targetRevision === undefined ? current.history?.[current.history.length - 1]?.config : current.history?.find(h => h.revision === targetRevision)?.config) : current.draft;
    if (!next) throw new BadRequestException(rollback ? '没有可回滚版本' : '请先保存草稿');
    this.assertValid(next);
    const unique = await this.checkUniqueness(next, id);
    if (!unique.unique) throw new ConflictException('供应商模型名称已存在');
    const result = await this.modelConfigModel.findOneAndUpdate(this.draftRevisionFilter(id, expectedRevision, expectedDraftRevision), {
      $set: { ...pickModelConfig(next), update_time: Date.now() }, $inc: { revision: 1, draft_revision: 1 },
      $unset: { draft: 1, ...Object.fromEntries(MODEL_CONFIG_FIELDS.filter(k => next[k] === undefined).map(k => [k, 1])) },
      $push: { history: { $each: [{ revision: current.revision || 0, config: pickModelConfig(current), saved_at: Date.now() }], $slice: -20 } },
    }, { new: true });
    if (!result) throw new ConflictException('配置已被修改，请重新加载');
    return result;
  }
  private assertValid(config: Record<string, any>) {
    const result = this.validateConfig(config);
    if (!result.valid) throw new BadRequestException({ message: '模型契约校验失败', errors: result.errors });
  }
  private assertRevision(actual: number | undefined, expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 0) throw new BadRequestException('版本号必须为非负安全整数');
    if ((actual || 0) !== expected) throw new ConflictException('配置已被修改，请重新加载');
  }
  private revisionFilter(id: string, revision: number): Record<string, any> {
    return revision === 0 ? { _id: id, $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { _id: id, revision };
  }
  private draftRevisionFilter(id: string, revision: number, draftRevision: number) {
    return { $and: [this.revisionFilter(id, revision), draftRevision === 0 ? { $or: [{ draft_revision: 0 }, { draft_revision: { $exists: false } }] } : { draft_revision: draftRevision }] };
  }

  /**
   * 获取配置模板
   * @param templateType 模板类型
   * @returns 配置模板
   */
  getConfigTemplate(templateType: string): Record<string, any> {
    const templates: Record<string, any> = {
      'llm-generation': languageModelPreset(),
      'voice-generation': voiceModelPreset(),
      'image-generation': {
        model_id: '',
        model_type: 'textToImage',
        provider: '',
        provider_model_name: '',
        model_name: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.01,
            unit_credit: 1,
            original_unit_credit: 1,
          },
        },
        params: {},
      },
      'video-generation': {
        model_id: '',
        model_type: 'textToVideo',
        provider: '',
        provider_model_name: '',
        model_name: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.03,
            unit_credit: 2,
            original_unit_credit: 2,
          },
        },
        params: {},
      },
      'face-swap': {
        model_id: '',
        model_type: 'characterSwap',
        provider: '',
        provider_model_name: '',
        model_name: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.02,
            unit_credit: 1,
            original_unit_credit: 1,
          },
        },
        params: {},
      },
    };

    return templates[templateType] || templates['image-generation'];
  }
}
