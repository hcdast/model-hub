import { Controller, Get, Post, Put, Delete, Body, Query, UseGuards, Req, Param, HttpException, BadRequestException, ConflictException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { BulkDeleteModelConfigDto, DeleteModelConfigDto } from './dto/delete-model-config.dto';
import { ModelConfigService } from './model-config.service';
import { pickCreditReferenceUnitFromPriceMap, validateMandatoryUnitPriceMap } from '../billing/unit-price-map.util';
import { pickModelConfig } from '../common/utils/model-contract';

@ApiTags('管理后台 - 模型配置')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/models')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminModelConfigController {
  constructor(
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
    private readonly modelConfigService: ModelConfigService,
  ) {}

  @Get()
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '模型配置列表（分页）' })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'model_type', required: false, description: '能力类型字符串，如 textToVideo' })
  @ApiQuery({ name: 'keyword', required: false, description: '匹配 model_id / model_name' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: '启用状态：enabled（仅启用）| disabled（仅禁用）| all（全部，默认）',
  })
  @ApiQuery({
    name: 'includeDisabled',
    required: false,
    description: '已废弃，请用 status=all；true 时等同 status=all',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'sort_order', required: false, enum: ['asc', 'desc'], description: '按更新时间排序，默认 desc（最新在前）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('provider') provider?: string,
    @Query('model_type') modelType?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('includeDisabled') includeDisabled?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort_order') sortOrder = 'desc',
  ) {
    const query = this.listFilter({ provider, model_type: modelType, keyword, status });

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [items, total] = await Promise.all([
      this.modelConfigModel
        .find(query)
        .sort({ update_time: sortOrder === 'asc' ? 1 : -1, model_id: 1, _id: 1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.modelConfigModel.countDocuments(query),
    ]);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  private listFilter({ provider, model_type: modelType, keyword, status }: Record<string, string | undefined>) {
    const query: Record<string, unknown> = {};
    if (provider) query.provider = provider;
    if (modelType !== undefined && modelType !== '') {
      query.model_type = modelType.trim();
    }
    const statusNorm = (status || '').trim().toLowerCase();
    if (statusNorm === 'enabled') {
      query.disabled = { $ne: true };
    } else if (statusNorm === 'disabled') {
      query.disabled = true;
    }
    // status=all 或未传：返回全部；includeDisabled=true 保留兼容，等同全部
    if (keyword && keyword.trim()) {
      const esc = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'i');
      query.$or = [{ model_id: re }, { model_name: re }];
    }

    return query;
  }

  @Get('export')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '导出全部筛选模型（固定记录集合并校验版本，最多 10000 条）' })
  async exportModels(@Query() params: Record<string, string>) {
    const exported_at = new Date().toISOString();
    const manifest = await this.modelConfigModel.find(this.listFilter(params))
      .select('_id revision update_time').sort({ _id: 1 }).limit(10001).maxTimeMS(10000).lean();
    if (manifest.length > 10000) throw new BadRequestException('超过 10000 条，请缩小筛选范围');
    // Read by immutable IDs, never by offsets in a changing update_time ordering.
    const rows = manifest.length ? await this.modelConfigModel.find({ _id: { $in: manifest.map(row => row._id) } }).maxTimeMS(10000).lean() : [];
    const byId = new Map(rows.map(row => [String(row._id), row]));
    if (byId.size !== manifest.length || manifest.some(entry => {
      const row = byId.get(String(entry._id));
      return !row || (row.revision || 0) !== (entry.revision || 0) || row.update_time !== entry.update_time;
    })) throw new ConflictException('导出期间配置已变化，请重试');
    return { code: 0, data: { version: 2, exported_at, total: manifest.length, items: manifest.map(entry => pickModelConfig(byId.get(String(entry._id))!)) } };
  }

  @Post('import/preview')
  @RequirePermissions('model:read')
  async previewImport(@Body() body: any, @Req() req: any) {
    return { code: 0, data: await this.modelConfigService.previewImport(body, req.user?.id || req.user?.userId || req.user?.sub) };
  }

  @Post('import/commit')
  @RequirePermissions('model:create', 'model:update')
  async commitImport(@Body() body: { planId: string }, @Req() req: any) {
    return { code: 0, data: await this.modelConfigService.commitImport(body.planId, req.user?.id || req.user?.userId || req.user?.sub) };
  }

  @Put('bulk')
  @RequirePermissions('model:update')
  async bulk(@Body() body: { items: Array<{ id: string; expected_revision: number }>; patch: Record<string, any> }, @Req() req: any) {
    return { code: 0, data: await this.modelConfigService.bulkUpdate(body.items, body.patch, req.user?.id || req.user?.sub) };
  }

  @Delete('bulk')
  @RequirePermissions('model:delete')
  @ApiOperation({ summary: '批量删除模型配置（逐条返回结果）' })
  async bulkDelete(@Body() body: BulkDeleteModelConfigDto) {
    return { code: 0, data: await this.modelConfigService.bulkDelete(body.items) };
  }

  @Delete(':id')
  @RequirePermissions('model:delete')
  @ApiOperation({ summary: '删除模型配置' })
  async remove(@Param('id') id: string, @Body() body: DeleteModelConfigDto) {
    return { code: 0, data: await this.modelConfigService.deleteConfig(id, body.expected_revision) };
  }

  @Get('templates')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '获取配置模板' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTemplates() {
    const templates = [
      { type: 'llm-generation', name: 'MaaS LLM · 编剧（待定价）', template: this.modelConfigService.getConfigTemplate('llm-generation') },
      { type: 'voice-generation', name: 'AKOOL OpenAPI · TTS（待定价）', template: this.modelConfigService.getConfigTemplate('voice-generation') },
      {
        type: 'image-generation',
        name: '图像生成模型',
        template: this.modelConfigService.getConfigTemplate('image-generation'),
      },
      {
        type: 'video-generation',
        name: '视频生成模型',
        template: this.modelConfigService.getConfigTemplate('video-generation'),
      },
      {
        type: 'face-swap',
        name: '换脸模型',
        template: this.modelConfigService.getConfigTemplate('face-swap'),
      },
    ];

    return {
      code: 0,
      data: {
        templates,
      },
    };
  }

  @Get('detail')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '模型详情（按 _id 或 model_id+provider 查询）' })
  @ApiQuery({ name: 'id', required: false, description: 'MongoDB _id' })
  @ApiQuery({ name: 'model_id', required: false, description: '对外 model_id，含 / 需 URL 编码' })
  @ApiQuery({ name: 'provider', required: false, description: '与 model_id 联用，多厂商同名时必填' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async detail(
    @Query('id') id?: string,
    @Query('model_id') modelId?: string,
    @Query('provider') provider?: string,
  ) {
    if (id) {
      const model = await this.modelConfigModel.findById(id).lean();
      if (!model) return { code: 3001, message: 'Model not found' };
      return { code: 0, data: model };
    }
    if (!modelId) return { code: 1001, message: 'id or model_id is required' };
    const decoded = decodeURIComponent(modelId);
    const query: Record<string, string> = { model_id: decoded };
    if (provider?.trim()) query.provider = provider.trim();
    const model = await this.modelConfigModel.findOne(query).sort({ sort: -1 }).lean();
    if (!model) return { code: 3001, message: 'Model not found' };
    return { code: 0, data: model };
  }

  @Put('toggle')
  @RequirePermissions('model:update')
  @ApiOperation({ summary: '启用/禁用模型' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async toggle(
    @Body() body: { id?: string; model_id?: string; provider?: string; disabled: boolean; expected_revision?: number },
  ) {
    if (typeof body.disabled !== 'boolean') return { code: 1001, message: 'disabled must be boolean' };

    const filter: Record<string, unknown> = {};
    if (body.id) {
      filter._id = body.id;
    } else if (body.model_id) {
      filter.model_id = body.model_id;
      if (body.provider?.trim()) filter.provider = body.provider.trim();
    } else {
      return { code: 1001, message: 'id or model_id is required' };
    }

    const current = await this.modelConfigModel.findOne(filter).lean();
    if (!current) return { code: 3001, message: 'Model not found' };
    const validation = this.modelConfigService.validateConfig({ ...current, disabled: body.disabled });
    if (!validation.valid) return {
      code: 1001,
      message: validation.errors.some(error => error.field === 'unit_price_map')
        ? '启停失败：模型定价不完整，请先在“定价”中填写并保存价格表'
        : '模型配置校验失败',
      errors: validation.errors,
    };
    const result = await this.modelConfigService.updateConfig(String(current._id), { disabled: body.disabled, expected_revision: body.expected_revision }, 'admin');
    return { code: 0, data: result };
  }

  @Post()
  @RequirePermissions('model:create')
  @ApiOperation({ summary: '创建模型配置' })
  @ApiResponse({ status: 200, description: '创建成功' })
  @ApiResponse({ status: 400, description: '数据验证失败' })
  @ApiResponse({ status: 409, description: '配置已存在' })
  async create(@Body() dto: CreateModelConfigDto, @Req() req: any) {
    try {
      // 获取用户 ID（从 JWT token 中）
      const userId = req.user?.id || req.user?.userId || 'unknown';

      // 调用 service 创建配置
      const config = await this.modelConfigService.createConfig(dto, userId);

      return {
        code: 0,
        data: config,
        message: '创建成功',
      };
    } catch (error: any) {
      // 处理验证错误
      if (error.message?.includes('数据验证失败')) {
        try {
          const errors = JSON.parse(error.message.split(': ')[1]);
          return {
            code: 1001,
            message: '数据验证失败',
            errors,
          };
        } catch {
          return {
            code: 1001,
            message: error.message,
          };
        }
      }

      // 处理唯一性冲突
      if (error.message?.includes('配置已存在')) {
        try {
          const conflicts = JSON.parse(error.message.split(': ')[1]);
          return {
            code: 1002,
            message: '配置已存在',
            conflicts,
          };
        } catch {
          return {
            code: 1002,
            message: error.message,
          };
        }
      }

      // 其他错误
      return {
        code: 500,
        message: error.message || '创建失败',
      };
    }
  }

  @Put(':id/pricing')
  @RequirePermissions('model:update')
  @ApiOperation({ summary: '更新模型定价' })
  @ApiResponse({ status: 200, description: '定价更新成功' })
  @ApiResponse({ status: 400, description: '请求参数无效' })
  @ApiResponse({ status: 404, description: '模型配置不存在' })
  async updatePricing(
    @Param('id') id: string,
    @Body() body: { unit_price_map: Record<string, any>; expected_revision?: number },
  ) {
    if (!body.unit_price_map || typeof body.unit_price_map !== 'object' || Object.keys(body.unit_price_map).length === 0) {
      return { code: 1001, message: 'unit_price_map 不能为空' };
    }
    const upmCheck = validateMandatoryUnitPriceMap(body.unit_price_map);
    if (!upmCheck.valid) {
      return { code: 1001, message: upmCheck.errors.join('；') };
    }

    const result = await this.modelConfigService.updateConfig(id, { unit_price_map: body.unit_price_map, expected_revision: body.expected_revision }, 'admin');

    return { code: 0, data: result, message: '定价更新成功' };
  }

  @Get('provider-pricing')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '获取模型在各供应商的定价信息（用于成本优先路由策略）' })
  @ApiQuery({ name: 'model_id', required: true, description: '模型标识（与创建任务 model 一致）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getProviderPricing(@Query('model_id') modelId?: string) {
    if (!modelId) return { code: 1001, message: 'model_id is required' };
    const decoded = decodeURIComponent(modelId);

    // 查询该模型标识下所有厂商的配置
    const configs = await this.modelConfigModel
      .find({ model_id: decoded, disabled: { $ne: true } })
      .select('provider unit_price_map')
      .lean();

    if (!configs.length) return { code: 0, data: [] };

    // 提取各厂商的定价信息（厂商参考 credit，与 unit_price_map 档位一致）
    const providerPricing = configs.map((config) => {
      const unitPriceMap = config.unit_price_map as Record<string, unknown> | undefined;
      const costPerUnit = pickCreditReferenceUnitFromPriceMap(unitPriceMap);

      return {
        provider: config.provider,
        costPerUnit,
      };
    });

    return { code: 0, data: providerPricing };
  }

  @Put(':id')
  @RequirePermissions('model:update')
  @ApiOperation({ summary: '更新模型配置' })
  async updateActive(@Param('id') id: string, @Body() dto: UpdateModelConfigDto, @Req() req: any) {
    return this.update(id, dto, req);
  }

  @Put(':id/draft')
  @RequirePermissions('model:update')
  async saveDraft(@Param('id') id: string, @Body() body: { config: Record<string, any>; expected_revision: number; expected_draft_revision?: number }) {
    return { code: 0, data: await this.modelConfigService.saveDraft(id, body.config || {}, body.expected_revision, body.expected_draft_revision) };
  }

  @Post(':id/publish')
  @RequirePermissions('model:update')
  async publish(@Param('id') id: string, @Body() body: { expected_revision: number; expected_draft_revision?: number }) {
    return { code: 0, data: await this.modelConfigService.publish(id, body.expected_revision, false, body.expected_draft_revision) };
  }

  @Post(':id/rollback')
  @RequirePermissions('model:update')
  async rollback(@Param('id') id: string, @Body() body: { expected_revision: number; expected_draft_revision?: number; target_revision?: number }) {
    return { code: 0, data: await this.modelConfigService.publish(id, body.expected_revision, true, body.expected_draft_revision, body.target_revision) };
  }

  @RequirePermissions('model:update')
  @ApiOperation({ summary: '更新模型配置' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '数据验证失败' })
  @ApiResponse({ status: 404, description: '模型配置不存在' })
  @ApiResponse({ status: 409, description: '配置已存在' })
  async update(@Param('id') id: string, @Body() dto: UpdateModelConfigDto, @Req() req: any) {
    try {
      // 获取用户 ID（从 JWT token 中）
      const userId = req.user?.id || req.user?.userId || 'unknown';

      // 调用 service 更新配置
      const config = await this.modelConfigService.updateConfig(id, dto, userId);

      return {
        code: 0,
        data: config,
        message: '更新成功',
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      // 处理模型不存在错误
      if (error.message?.includes('模型配置不存在')) {
        return {
          code: 3001,
          message: '模型配置不存在',
        };
      }

      // 处理验证错误
      if (error.message?.includes('数据验证失败')) {
        try {
          const errors = JSON.parse(error.message.split(': ')[1]);
          return {
            code: 1001,
            message: '数据验证失败',
            errors,
          };
        } catch {
          return {
            code: 1001,
            message: error.message,
          };
        }
      }

      // 处理唯一性冲突
      if (error.message?.includes('配置已存在')) {
        try {
          const conflicts = JSON.parse(error.message.split(': ')[1]);
          return {
            code: 1002,
            message: '配置已存在',
            conflicts,
          };
        } catch {
          return {
            code: 1002,
            message: error.message,
          };
        }
      }

      // 其他错误
      return {
        code: 500,
        message: error.message || '更新失败',
      };
    }
  }
}
