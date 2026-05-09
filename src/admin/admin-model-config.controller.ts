import { Controller, Get, Post, Put, Body, Query, UseGuards, Req, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ModelConfigService } from './model-config.service';
import { pickCreditReferenceUnitFromPriceMap } from '../billing/unit-price-map.util';

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
  @ApiQuery({ name: 'service', required: false })
  @ApiQuery({ name: 'model_type', required: false, description: '单个 model_type 数字' })
  @ApiQuery({ name: 'keyword', required: false, description: '匹配 model_name / label' })
  @ApiQuery({ name: 'includeDisabled', required: false, description: 'true 时包含禁用' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('provider') provider?: string,
    @Query('service') service?: string,
    @Query('model_type') modelType?: string,
    @Query('keyword') keyword?: string,
    @Query('includeDisabled') includeDisabled?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const query: Record<string, unknown> = {};
    if (provider) query.provider = provider;
    if (service) query.service = service;
    if (modelType !== undefined && modelType !== '') {
      const t = parseInt(modelType, 10);
      if (!Number.isNaN(t)) query.model_type = t;
    }
    if (includeDisabled !== 'true') query.disabled = { $ne: true };
    if (keyword && keyword.trim()) {
      const esc = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'i');
      query.$or = [{ model_name: re }, { label: re }];
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [items, total] = await Promise.all([
      this.modelConfigModel
        .find(query)
        .sort({ sort: -1, model_name: 1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.modelConfigModel.countDocuments(query),
    ]);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Get('templates')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '获取配置模板' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTemplates() {
    const templates = [
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
  @ApiOperation({ summary: '模型详情（按 model_name 查询）' })
  @ApiQuery({ name: 'model_name', required: true, description: '完整模型名，含 / 需 URL 编码' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async detail(@Query('model_name') modelName?: string) {
    if (!modelName) return { code: 1001, message: 'model_name is required' };
    const decoded = decodeURIComponent(modelName);
    const model = await this.modelConfigModel.findOne({ model_name: decoded }).lean();
    if (!model) return { code: 3001, message: 'Model not found' };
    return { code: 0, data: model };
  }

  @Put('toggle')
  @RequirePermissions('model:update')
  @ApiOperation({ summary: '启用/禁用模型' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async toggle(@Body() body: { model_name: string; disabled: boolean }) {
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
    @Body() body: { unit_price_map: Record<string, any> },
  ) {
    if (!body.unit_price_map || typeof body.unit_price_map !== 'object' || Object.keys(body.unit_price_map).length === 0) {
      return { code: 1001, message: 'unit_price_map 不能为空' };
    }

    const result = await this.modelConfigModel.findByIdAndUpdate(
      id,
      { $set: { unit_price_map: body.unit_price_map, update_time: Date.now() } },
      { new: true },
    );

    if (!result) {
      return { code: 3001, message: '模型配置不存在' };
    }

    return { code: 0, data: result, message: '定价更新成功' };
  }

  @Get('provider-pricing')
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '获取模型在各厂商的定价信息（用于成本优先路由规则）' })
  @ApiQuery({ name: 'model_name', required: true, description: '模型名称' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getProviderPricing(@Query('model_name') modelName?: string) {
    if (!modelName) return { code: 1001, message: 'model_name is required' };
    const decoded = decodeURIComponent(modelName);

    // 查询该模型名下所有厂商的配置
    const configs = await this.modelConfigModel
      .find({ model_name: decoded, disabled: { $ne: true } })
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
