import { FilterQuery, Model, isValidObjectId } from 'mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';

export async function findExplicitModelConfig(db: Model<ModelConfigDocument>, modelId: string, options: Record<string, any>, modelType?: string, routedProvider?: string): Promise<ModelConfig> {
  if (typeof options.configId !== 'string' || !isValidObjectId(options.configId)) throw new BadRequestException('Invalid configId');
  if (options.configRevision !== undefined && (!Number.isSafeInteger(options.configRevision) || options.configRevision < 0)) throw new BadRequestException('Invalid configRevision');
  const cfg = await db.findOne({ _id: options.configId, model_id: modelId, ...(modelType ? { model_type: modelType } : {}) }).lean();
  if (!cfg) throw new BadRequestException('所选模型配置不存在');
  if (routedProvider && routedProvider !== cfg.provider) throw new ConflictException('所选配置与路由规则不一致，请重新选择模型');
  if (options.configRevision !== undefined && options.configRevision !== (cfg.revision || 0)) throw new ConflictException('模型配置已更新，请刷新后重试');
  return cfg;
}

/**
 * 按对外 model_id（及可选 model_type、provider）解析 model_configs。
 * 多厂商共用同一 model_id 时须带 provider（通常来自路由规则）；否则取 sort 最高的一条。
 */
export async function findModelConfigForTask(
  modelConfigModel: Model<ModelConfigDocument>,
  modelId: string,
  modelType?: string,
  provider?: string,
): Promise<ModelConfig | null> {
  const base: FilterQuery<ModelConfig> = { model_id: modelId };
  if (modelType) {
    base.model_type = modelType;
  }

  if (provider) {
    return modelConfigModel.findOne({ ...base, provider }).lean();
  }

  const enabled = await modelConfigModel
    .find({ ...base, disabled: { $ne: true } })
    .sort({ sort: -1 })
    .lean();

  if (enabled.length > 0) {
    return enabled[0];
  }

  const doc = await modelConfigModel.findOne(base).sort({ sort: -1 }).lean();
  if (doc || !modelType) {
    return doc;
  }

  // model_type 与库中不一致时，仍按 model_id 匹配（避免漏配 params / provider）
  const byIdOnly: FilterQuery<ModelConfig> = { model_id: modelId };
  return modelConfigModel.findOne(byIdOnly).sort({ sort: -1 }).lean();
}
