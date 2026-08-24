import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { generateParamDoc } from '../common/utils/param-doc-generator';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';

@ApiTags('模型配置')
@Controller('v1/models')
@UseGuards(ApiKeyOrJwtGuard)
export class ModelConfigController {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
  ) {}

  @Get()
  @ApiOperation({ summary: '模型列表', description: '查询可用模型列表，兼容 AGI-Content aiModelConfig/list 的数据结构' })
  @ApiQuery({
    name: 'types',
    required: false,
    description: '能力类型（逗号分隔 camelCase），如 textToVideo,imageToVideo',
  })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'disabled', required: false, description: 'true 时包含禁用模型' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listModels(
    @Query('types') types?: string,
    @Query('provider') provider?: string,
    @Query('disabled') disabled?: string,
  ) {
    const query: any = {};
    if (types) {
      const typeArray = types
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (typeArray.length > 0) query.model_type = { $in: typeArray };
    }
    if (provider) query.provider = provider;
    if (disabled !== 'true') query.disabled = { $ne: true };

    const items = await this.modelConfigModel
      .find(query)
      .sort({ sort: -1, model_id: 1 })
      .lean();

    return { code: 0, data: { items, total: items.length } };
  }

  /** model_id 常含 `/`，不能用单段路径参数 */
  @Get('by-name')
  @ApiOperation({
    summary: '模型详情',
    description: '通过 query `model_id` 获取完整配置（含 params）。含 `/` 时请 URL 编码，例如 encodeURIComponent("wavespeed-ai/flux-2-pro/text-to-image")',
  })
  @ApiQuery({ name: 'model_id', required: true })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getModelByName(@Query('model_id') modelId?: string) {
    if (!modelId) return { code: 1001, message: 'model_id is required' };
    const decoded = decodeURIComponent(modelId);
    const model = await this.modelConfigModel.findOne({ model_id: decoded }).lean();
    if (!model) return { code: 3001, message: 'Model not found' };
    return { code: 0, data: model };
  }

  @Get('params-doc')
  @ApiOperation({
    summary: '模型参数文档',
    description: '根据 model_id 或 model_type 查询模型参数文档。至少提供一个查询参数。',
  })
  @ApiQuery({ name: 'model_id', required: false, description: '模型标识（精确匹配）' })
  @ApiQuery({ name: 'model_type', required: false, description: '能力类型（camelCase）' })
  @ApiResponse({ status: 200, description: '查询成功，返回结构化参数文档' })
  async getParamsDoc(
    @Query('model_id') modelId?: string,
    @Query('model_type') modelType?: string,
  ) {
    if (!modelId && !modelType) {
      return { code: 1001, message: 'model_id 或 model_type 至少提供一个' };
    }

    const query: any = { disabled: { $ne: true } };
    if (modelId) query.model_id = decodeURIComponent(modelId);
    if (modelType) {
      const t = modelType.trim();
      if (!t) return { code: 1001, message: 'model_type 无效' };
      query.model_type = t;
    }

    const configs = await this.modelConfigModel.find(query).lean<ModelConfig[]>();
    const docs = configs
      .filter((cfg) => cfg.params && Object.keys(cfg.params).length > 0)
      .map((cfg) => generateParamDoc(cfg as ModelConfig));

    return { code: 0, data: { items: docs, total: docs.length } };
  }

}
