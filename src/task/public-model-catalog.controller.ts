import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { generateParamDoc } from '../common/utils/param-doc-generator';
import { publicDefinition, publicDefinitions, publicValue } from '../common/utils/model-contract';
import { modelUsageType } from '../common/utils/model-pricing';

// Public catalog responses deliberately omit routing, billing and hidden parameters.
const catalogFields = 'model_id model_type model_name provider description tags sort';
const summary = (model: ModelConfig & { _id?: unknown }) => ({
  ...(model._id ? { config_id: String(model._id) } : {}),
  model_id: model.model_id,
  model_type: model.model_type,
  model_name: model.model_name,
  provider: model.provider,
  description: model.description || '',
  tags: (model.tags || []).filter((tag): tag is string => typeof tag === 'string'),
});

@ApiTags('公开模型目录')
@Controller('v1/catalog/models')
export class PublicModelCatalogController {
  constructor(@InjectModel(ModelConfig.name) private readonly models: Model<ModelConfigDocument>) {}

  @Get()
  @ApiOperation({ summary: '公开的可用模型列表（无需登录）' })
  async list() {
    const models = await this.models.find({ disabled: { $ne: true } })
      .select(catalogFields).sort({ sort: -1, model_id: 1, model_type: 1 }).lean<ModelConfig[]>();
    return { items: models.map(summary), total: models.length };
  }

  @Get('detail')
  @ApiOperation({ summary: '公开的模型说明及可见参数文档（无需登录）' })
  @ApiQuery({ name: 'model_id', required: true })
  @ApiQuery({ name: 'model_type', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'config_id', required: false })
  async detail(@Query('model_id') modelId?: string, @Query('model_type') modelType?: string, @Query('provider') provider?: string, @Query('config_id') configId?: string) {
    if (configId !== undefined && (typeof configId !== 'string' || !isValidObjectId(configId))) throw new BadRequestException('Invalid config_id');
    if (typeof modelId !== 'string' || !modelId.trim() || modelId.length > 200 ||
      (modelType !== undefined && (typeof modelType !== 'string' || !modelType.trim() || modelType.length > 100)) ||
      (provider !== undefined && (typeof provider !== 'string' || !provider.trim() || provider.length > 100))) {
      throw new BadRequestException('A valid model_id and optional model_type are required');
    }
    const model = await this.models.findOne({
      model_id: modelId.trim(), disabled: { $ne: true },
      ...(configId ? { _id: configId } : {}),
      ...(modelType ? { model_type: modelType.trim() } : {}),
      ...(provider ? { provider: provider.trim() } : {}),
    }).select(`${catalogFields} params params_rules ui_schema output_schema docs examples pricing unit_price_map contract_version revision`).lean<ModelConfig & { _id?: unknown }>();
    if (!model) throw new NotFoundException('Model not found');
    // params may also contain editor layout metadata such as `ui`.
    const params = Object.fromEntries(Object.entries(model.params || {}).filter(([, definition]) =>
      definition && typeof definition === 'object' &&
      ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(definition.type),
    ));
    const visible = publicDefinitions(params);
    const names = new Set(Object.keys(visible));
    const rules = (model.params_rules || []).filter(r => r.when.every(c => names.has(c.field)) &&
      [...(r.require || []), ...(r.forbid || []), ...Object.keys(r.values || {}), ...(r.maxTotalItems?.fields || [])].every(f => names.has(f)))
      .map(r => ({ when: r.when.map(c => ({ field: c.field, operator: c.operator, ...(c.value !== undefined ? { value: c.value } : {}) })),
        ...(r.require ? { require: r.require } : {}), ...(r.forbid ? { forbid: r.forbid } : {}), ...(r.values ? { values: r.values } : {}),
        ...(r.maxTotalItems ? { maxTotalItems: { fields: r.maxTotalItems.fields, max: r.maxTotalItems.max } } : {}), ...(r.message ? { message: r.message } : {}) }));
    return { ...summary(model), config_id: String(model._id || ''), revision: model.revision || 0, contract_version: model.contract_version || 1,
      params: generateParamDoc({ ...model, params }).params,
      params_rules: rules,
      ui_schema: { order: model.ui_schema?.order?.filter(f => names.has(f)), advanced: model.ui_schema?.advanced?.filter(f => names.has(f)),
        groups: Object.fromEntries(Object.entries(model.ui_schema?.groups || {}).map(([group, fields]) => [group, fields.filter(f => names.has(f))])) },
      docs: { sections: model.docs?.sections?.map(s => ({ title: s.title, content: s.content })), limitations: model.docs?.limitations },
      output_schema: model.output_schema ? publicDefinition(model.output_schema) : undefined,
      examples: (model.examples || []).map(e => ({ name: e.name, input: publicValue(e.input, { type: 'object', required: false, properties: visible }),
        ...(e.output !== undefined && model.output_schema ? { output: publicValue(e.output, publicDefinition(model.output_schema)) } : {}) })),
      public_pricing: { currency: 'credit', usage_type: model.pricing?.usage_type || modelUsageType(model.model_type),
        usage_measure: model.pricing?.usage_measure,
        tiers: Object.fromEntries(Object.entries(model.unit_price_map || {}).filter(([, v]) => typeof v?.unit_credit === 'number' && v.unit_credit > 0).map(([k, v]) => [k, v.unit_credit])),
        usage_param: names.has(model.pricing?.usage_param || '') ? model.pricing?.usage_param : undefined,
        tier_param: names.has(model.pricing?.tier_param || '') ? model.pricing?.tier_param : undefined,
        tier_rules: model.pricing?.tier_rules?.filter(rule => rule.when.every(c => names.has(c.field)))
          .map(rule => ({ tier: rule.tier, when: rule.when.map(c => ({ field: c.field, operator: c.operator, ...(c.value !== undefined ? { value: c.value } : {}) })) })),
        auto_value: model.pricing?.auto_value, auto_prelock_units: model.pricing?.auto_prelock_units },
    };
  }
}
