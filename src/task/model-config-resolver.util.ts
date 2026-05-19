import { FilterQuery, Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';

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
