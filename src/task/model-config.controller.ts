import { Controller, Get, Post, Put, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { generateParamDoc } from '../common/utils/param-doc-generator';
import { validateMandatoryUnitPriceMap } from '../billing/unit-price-map.util';

@ApiTags('模型配置')
@Controller('v1/models')
export class ModelConfigController {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
  ) {}

  @Get()
  @ApiOperation({ summary: '模型列表', description: '查询可用模型列表，兼容 AGI-Content aiModelConfig/list 的数据结构' })
  @ApiQuery({ name: 'types', required: false, description: '模型子类型（逗号分隔），如 1,2,11,12' })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'service', required: false })
  @ApiQuery({ name: 'disabled', required: false, description: 'true 时包含禁用模型' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listModels(
    @Query('types') types?: string,
    @Query('provider') provider?: string,
    @Query('service') service?: string,
    @Query('disabled') disabled?: string,
  ) {
    const query: any = {};
    if (types) {
      const typeArray = types.split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => !isNaN(n));
      if (typeArray.length > 0) query.model_type = { $in: typeArray };
    }
    if (provider) query.provider = provider;
    if (service) query.service = service;
    if (disabled !== 'true') query.disabled = { $ne: true };

    const items = await this.modelConfigModel
      .find(query)
      .sort({ sort: -1, model_name: 1 })
      .lean();

    return { code: 0, data: { items, total: items.length } };
  }

  /** model_name 常含 `/`，不能用单段路径参数 */
  @Get('by-name')
  @ApiOperation({
    summary: '模型详情',
    description: '通过 query `model_name` 获取完整配置（含 params）。含 `/` 时请 URL 编码，例如 encodeURIComponent("wavespeed-ai/flux-2-pro/text-to-image")',
  })
  @ApiQuery({ name: 'model_name', required: true })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getModelByName(@Query('model_name') modelName?: string) {
    if (!modelName) return { code: 1001, message: 'model_name is required' };
    const decoded = decodeURIComponent(modelName);
    const model = await this.modelConfigModel.findOne({ model_name: decoded }).lean();
    if (!model) return { code: 3001, message: 'Model not found' };
    return { code: 0, data: model };
  }

  @Get('params-doc')
  @ApiOperation({
    summary: '模型参数文档',
    description: '根据 model_name 或 model_type 查询模型参数文档。至少提供一个查询参数。',
  })
  @ApiQuery({ name: 'model_name', required: false, description: '模型名称（精确匹配）' })
  @ApiQuery({ name: 'model_type', required: false, description: '模型类型编号' })
  @ApiResponse({ status: 200, description: '查询成功，返回结构化参数文档' })
  async getParamsDoc(
    @Query('model_name') modelName?: string,
    @Query('model_type') modelType?: string,
  ) {
    if (!modelName && !modelType) {
      return { code: 1001, message: 'model_name 或 model_type 至少提供一个' };
    }

    const query: any = { disabled: { $ne: true } };
    if (modelName) query.model_name = decodeURIComponent(modelName);
    if (modelType) {
      const parsed = parseInt(modelType, 10);
      if (isNaN(parsed)) return { code: 1001, message: 'model_type 必须是数字' };
      query.model_type = parsed;
    }

    const configs = await this.modelConfigModel.find(query).lean<ModelConfig[]>();
    const docs = configs
      .filter((cfg) => cfg.params && Object.keys(cfg.params).length > 0)
      .map((cfg) => generateParamDoc(cfg as ModelConfig));

    return { code: 0, data: { items: docs, total: docs.length } };
  }

  @Post()
  @ApiOperation({ summary: '创建/更新模型配置', description: '按 model_name upsert 模型配置' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async upsertModel(@Body() body: Record<string, any>) {
    if (!body.model_name) return { code: 1001, message: 'model_name is required' };
    const upmCheck = validateMandatoryUnitPriceMap(body.unit_price_map);
    if (!upmCheck.valid) {
      return { code: 1001, message: upmCheck.errors.join('；') };
    }

    const result = await this.modelConfigModel.findOneAndUpdate(
      { model_name: body.model_name },
      { $set: { ...body, update_time: Date.now() } },
      { upsert: true, new: true },
    );

    return { code: 0, data: result };
  }

  @Post('batch')
  @ApiOperation({ summary: '批量导入模型配置', description: '批量 upsert 模型配置（兼容 importAiModelConfigs 脚本格式）' })
  @ApiResponse({ status: 200, description: '导入完成' })
  async batchImport(@Body() body: { models: Record<string, any>[]; force?: boolean }) {
    const { models, force = false } = body;
    if (!Array.isArray(models)) return { code: 1001, message: 'models must be an array' };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const model of models) {
      if (!model.model_name) { skipped++; continue; }

      const upmCheck = validateMandatoryUnitPriceMap(model.unit_price_map);
      if (!upmCheck.valid) {
        return { code: 1001, message: `${model.model_name}: ${upmCheck.errors.join('；')}` };
      }

      const existing = await this.modelConfigModel.findOne({ model_name: model.model_name }).lean();

      if (existing && !force) {
        skipped++;
        continue;
      }

      await this.modelConfigModel.findOneAndUpdate(
        { model_name: model.model_name },
        { $set: { ...model, update_time: Date.now() } },
        { upsert: true },
      );

      if (existing) updated++;
      else inserted++;
    }

    return { code: 0, data: { inserted, updated, skipped, total: models.length } };
  }

  @Put('toggle')
  @ApiOperation({ summary: '启用/禁用模型', description: 'Body: { model_name, disabled }，model_name 含 `/` 时原样 JSON 传递即可' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async toggleModel(@Body() body: { model_name: string; disabled: boolean }) {
    if (!body.model_name) return { code: 1001, message: 'model_name is required' };
    if (typeof body.disabled !== 'boolean') return { code: 1001, message: 'disabled must be boolean' };

    const result = await this.modelConfigModel.findOneAndUpdate(
      { model_name: body.model_name },
      { $set: { disabled: body.disabled, update_time: Date.now() } },
      { new: true },
    );
    if (!result) return { code: 3001, message: 'Model not found' };
    return { code: 0, data: result };
  }
}
