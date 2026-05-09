import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ValidationResult, UniquenessCheckResult, ConflictInfo } from './interfaces/validation.interface';
import { ModelConfigValidator } from './utils/model-config-validator';
import { validateParamDefinitions } from '../common/utils/param-definition-validator';

/**
 * 模型配置服务
 * 负责模型配置的业务逻辑处理
 */
@Injectable()
export class ModelConfigService {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
  ) {}

  /**
   * 验证配置数据
   * @param config 配置对象
   * @returns 验证结果
   */
  validateConfig(config: Partial<ModelConfig>): ValidationResult {
    return ModelConfigValidator.validateConfig(config as Record<string, any>);
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

    // 检查 model_name + model_type + service 组合唯一性
    if (config.model_name && config.model_type && config.service) {
      const query: any = {
        model_name: config.model_name,
        model_type: config.model_type,
        service: config.service,
      };

      // 更新时排除自身
      if (excludeId) {
        query._id = { $ne: excludeId };
      }

      const existing = await this.modelConfigModel.findOne(query).lean();
      if (existing) {
        conflicts.push({
          field: 'model_name+model_type+service',
          value: `${config.model_name}+${config.model_type}+${config.service}`,
          existingModelName: existing.model_name,
        });
      }
    }

    // 检查 provider_model_name 唯一性
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
          existingModelName: existing.model_name,
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
    // 验证配置数据
    const validationResult = this.validateConfig(dto);
    if (!validationResult.valid) {
      throw new Error(`数据验证失败: ${JSON.stringify(validationResult.errors)}`);
    }

    // 校验 params 参数定义结构
    if (dto.params && Object.keys(dto.params).length > 0) {
      const paramDefResult = validateParamDefinitions(dto.params);
      if (!paramDefResult.valid) {
        throw new Error(`参数定义校验失败: ${JSON.stringify(paramDefResult.errors)}`);
      }
    }

    // 检查唯一性
    const uniquenessResult = await this.checkUniqueness(dto);
    if (!uniquenessResult.unique) {
      throw new Error(`配置已存在: ${JSON.stringify(uniquenessResult.conflicts)}`);
    }

    // 创建配置
    const now = Date.now();
    const config = new this.modelConfigModel({
      ...dto,
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

    // 合并配置数据
    const mergedConfig = { ...existing.toObject(), ...dto };

    // 验证配置数据
    const validationResult = this.validateConfig(mergedConfig);
    if (!validationResult.valid) {
      throw new Error(`数据验证失败: ${JSON.stringify(validationResult.errors)}`);
    }

    // 校验 params 参数定义结构
    const paramsToValidate = dto.params ?? mergedConfig.params;
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
    const updated = await this.modelConfigModel.findByIdAndUpdate(
      id,
      {
        $set: {
          ...dto,
          update_time: Date.now(),
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new Error('更新失败');
    }

    return updated;
  }

  /**
   * 获取配置模板
   * @param templateType 模板类型
   * @returns 配置模板
   */
  getConfigTemplate(templateType: string): Record<string, any> {
    const templates: Record<string, any> = {
      'image-generation': {
        model_name: '',
        model_type: 40001,
        provider: '',
        provider_model_name: '',
        service: '',
        group: '',
        label: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unusable: false,
        display: true,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.01,
            unit_credit: 1,
            original_unit_credit: 1,
          },
        },
        audio_extra_credit_multiplier: 1,
        discount: {},
        requires_priority: 10,
        requires_priority_4_unlimit_mode: -1,
        supported_unlimit_mode: false,
        supported_unlimit_mode_start_time: 0,
        supported_last_frame: false,
        supported_first_frame: false,
        supported_extend_prompt: false,
        supported_reference: false,
        supported_variation: false,
        params: {},
      },
      'video-generation': {
        model_name: '',
        model_type: 42001,
        provider: '',
        provider_model_name: '',
        service: '',
        group: '',
        label: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unusable: false,
        display: true,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.03,
            unit_credit: 2,
            original_unit_credit: 2,
          },
        },
        audio_extra_credit_multiplier: 1,
        discount: {},
        requires_priority: 10,
        requires_priority_4_unlimit_mode: 9,
        supported_unlimit_mode: true,
        supported_unlimit_mode_start_time: 0,
        supported_last_frame: false,
        supported_first_frame: false,
        supported_extend_prompt: false,
        supported_keep_original_sound: false,
        is_extend_model: false,
        params: {},
      },
      'face-swap': {
        model_name: '',
        model_type: 43001,
        provider: '',
        provider_model_name: '',
        service: '',
        group: '',
        label: '',
        description: '',
        tags: [],
        sort: 100,
        disabled: false,
        unusable: false,
        display: true,
        unit_price_map: {
          default: {
            cost_unit_price: 0,
            sale_unit_price: 0.02,
            unit_credit: 1,
            original_unit_credit: 1,
          },
        },
        audio_extra_credit_multiplier: 1,
        discount: {},
        requires_priority: 10,
        requires_priority_4_unlimit_mode: -1,
        supported_unlimit_mode: false,
        supported_unlimit_mode_start_time: 0,
        params: {},
      },
    };

    return templates[templateType] || templates['image-generation'];
  }
}
