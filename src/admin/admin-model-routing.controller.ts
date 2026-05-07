import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ModelRoutingRule,
  ModelRoutingRuleDocument,
} from '../database/schemas/model-routing-rule.schema';
import { RoutingPreviewService } from '../task/routing-preview.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

const STRATEGIES = new Set(['fixed', 'weighted', 'primary_fallback', 'latency', 'cost']);

@ApiTags('管理后台 - 模型路由规则')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/model-routing-rules')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminModelRoutingController {
  constructor(
    @InjectModel(ModelRoutingRule.name)
    private readonly ruleModel: Model<ModelRoutingRuleDocument>,
    private readonly routingPreview: RoutingPreviewService,
  ) {}

  @Post('simulate')
  @RequirePermissions('model:read')
  @ApiOperation({
    summary: '路由仿真 / 调试',
    description:
      '输入 model_name、client_id（及可选 featureType、生效时间），返回规则命中详情与 model_configs 兜底解析，不写指标、不入队。',
  })
  @ApiResponse({ status: 200, description: '成功' })
  async simulate(
    @Body()
    body: {
      model_name?: string;
      client_id?: string;
      featureType?: string;
      options?: Record<string, unknown>;
      at?: string;
    },
  ) {
    const modelName = body.model_name != null ? String(body.model_name).trim() : '';
    const clientId = body.client_id != null ? String(body.client_id).trim() : '';
    if (!modelName) {
      throw new BadRequestException('model_name is required');
    }
    if (!clientId) {
      throw new BadRequestException('client_id is required');
    }
    let at: Date | undefined;
    if (body.at != null && String(body.at).trim() !== '') {
      at = new Date(String(body.at));
      if (Number.isNaN(at.getTime())) {
        throw new BadRequestException('at must be a valid ISO date string');
      }
    }
    const data = await this.routingPreview.preview({
      model: modelName,
      clientId,
      featureType: body.featureType,
      options: body.options,
      at,
    });
    return { code: 0, data };
  }

  @Get()
  @RequirePermissions('model:read')
  @ApiOperation({ summary: '路由规则列表' })
  @ApiQuery({ name: 'model_name', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '成功' })
  async list(
    @Query('model_name') modelName?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const query: Record<string, unknown> = {};
    if (modelName && modelName.trim()) query.model_name = modelName.trim();

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [items, total] = await Promise.all([
      this.ruleModel
        .find(query)
        .sort({ model_name: 1, priority: -1, client_id: 1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.ruleModel.countDocuments(query),
    ]);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Post()
  @RequirePermissions('model:create')
  @ApiOperation({ summary: '创建路由规则' })
  @ApiResponse({ status: 200, description: '成功' })
  async create(@Body() body: Record<string, unknown>) {
    this.validateUpsert(body, true);
    const doc = await this.ruleModel.create({
      model_name: String(body.model_name).trim(),
      client_id: body.client_id != null ? String(body.client_id).trim() : '',
      enabled: body.enabled !== false,
      priority: typeof body.priority === 'number' ? body.priority : parseInt(String(body.priority || '0'), 10) || 0,
      effective_from: body.effective_from ? new Date(String(body.effective_from)) : undefined,
      effective_until: body.effective_until ? new Date(String(body.effective_until)) : undefined,
      strategy_type: body.strategy_type,
      fixed_provider: body.fixed_provider != null ? String(body.fixed_provider).trim() : undefined,
      weighted_targets: Array.isArray(body.weighted_targets) ? body.weighted_targets : [],
      primary_provider: body.primary_provider != null ? String(body.primary_provider).trim() : undefined,
      fallback_provider: body.fallback_provider != null ? String(body.fallback_provider).trim() : undefined,
      primary_weight: parseOptionalNonNegNumber(body.primary_weight),
      fallback_weight: parseOptionalNonNegNumber(body.fallback_weight),
      latency_targets: Array.isArray(body.latency_targets) ? body.latency_targets : [],
      cost_targets: Array.isArray(body.cost_targets) ? body.cost_targets : [],
      note: body.note != null ? String(body.note) : undefined,
    });
    return { code: 0, data: doc.toObject() };
  }

  @Put(':id')
  @RequirePermissions('model:update')
  @ApiOperation({ summary: '更新路由规则' })
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }
    this.validateUpsert(body, false);
    const $set: Record<string, unknown> = {};
    // 允许编辑 model_name
    if (body.model_name !== undefined) $set.model_name = String(body.model_name).trim();
    if (body.client_id !== undefined) $set.client_id = String(body.client_id).trim();
    if (body.enabled !== undefined) $set.enabled = Boolean(body.enabled);
    if (body.priority !== undefined) {
      $set.priority = typeof body.priority === 'number' ? body.priority : parseInt(String(body.priority), 10) || 0;
    }
    if (body.effective_from !== undefined) {
      $set.effective_from = body.effective_from ? new Date(String(body.effective_from)) : null;
    }
    if (body.effective_until !== undefined) {
      $set.effective_until = body.effective_until ? new Date(String(body.effective_until)) : null;
    }
    if (body.strategy_type !== undefined) $set.strategy_type = body.strategy_type;
    if (body.fixed_provider !== undefined) {
      $set.fixed_provider = body.fixed_provider != null && String(body.fixed_provider).trim() !== ''
        ? String(body.fixed_provider).trim()
        : undefined;
    }
    if (body.weighted_targets !== undefined) $set.weighted_targets = body.weighted_targets;
    if (body.primary_provider !== undefined) $set.primary_provider = body.primary_provider;
    if (body.fallback_provider !== undefined) $set.fallback_provider = body.fallback_provider;
    if (body.primary_weight !== undefined) $set.primary_weight = parseOptionalNonNegNumber(body.primary_weight);
    if (body.fallback_weight !== undefined) $set.fallback_weight = parseOptionalNonNegNumber(body.fallback_weight);
    if (body.latency_targets !== undefined) $set.latency_targets = body.latency_targets;
    if (body.cost_targets !== undefined) $set.cost_targets = body.cost_targets;
    if (body.note !== undefined) $set.note = body.note;

    const doc = await this.ruleModel.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    if (!doc) return { code: 3001, message: 'Rule not found' };
    return { code: 0, data: doc };
  }

  @Delete(':id')
  @RequirePermissions('model:delete')
  @ApiOperation({ summary: '删除路由规则' })
  async remove(@Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }
    const r = await this.ruleModel.findByIdAndDelete(id);
    if (!r) return { code: 3001, message: 'Rule not found' };
    return { code: 0, data: { deleted: true } };
  }

  private validateUpsert(body: Record<string, unknown>, isCreate: boolean) {
    if (isCreate && (!body.model_name || String(body.model_name).trim() === '')) {
      throw new BadRequestException('model_name is required');
    }
    if (body.strategy_type != null && !STRATEGIES.has(String(body.strategy_type))) {
      throw new BadRequestException(`strategy_type must be one of: ${[...STRATEGIES].join(', ')}`);
    }

    const st = body.strategy_type != null ? String(body.strategy_type) : null;

    if (isCreate) {
      if (!st) throw new BadRequestException('strategy_type is required');
      this.validateStrategyPayload(st, body, true);
    } else if (st) {
      this.validateStrategyPayload(st, body, false);
    } else if (body.weighted_targets !== undefined) {
      this.validateWeightedTargets(body.weighted_targets);
    } else if (body.primary_provider !== undefined || body.fallback_provider !== undefined) {
      this.validatePrimaryFallbackFields(body);
    } else if (body.latency_targets !== undefined) {
      this.validateLatencyTargets(body.latency_targets);
    } else if (body.cost_targets !== undefined) {
      this.validateCostTargets(body.cost_targets);
    }
  }

  private validateStrategyPayload(st: string, body: Record<string, unknown>, isCreate: boolean) {
    if (st === 'fixed') {
      if (isCreate || body.fixed_provider !== undefined) {
        if (!body.fixed_provider || String(body.fixed_provider).trim() === '') {
          throw new BadRequestException('fixed_provider is required when strategy_type is fixed');
        }
      }
    }
    if (st === 'weighted') {
      if (isCreate || body.weighted_targets !== undefined) {
        this.validateWeightedTargets(body.weighted_targets);
      }
    }
    if (st === 'primary_fallback') {
      if (isCreate || body.primary_provider !== undefined) {
        if (!body.primary_provider || String(body.primary_provider).trim() === '') {
          throw new BadRequestException('primary_provider is required when strategy_type is primary_fallback');
        }
      }
      this.validatePrimaryFallbackFields(body);
    }
    if (st === 'latency') {
      if (isCreate || body.latency_targets !== undefined) {
        this.validateLatencyTargets(body.latency_targets);
      }
    }
    if (st === 'cost') {
      if (isCreate || body.cost_targets !== undefined) {
        this.validateCostTargets(body.cost_targets);
      }
    }
  }

  private validateWeightedTargets(raw: unknown) {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('weighted_targets must be a non-empty array');
    }
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('weighted_targets: each item must be { provider, weight }');
      }
      const o = item as { provider?: unknown; weight?: unknown };
      const provider = o.provider != null ? String(o.provider).trim() : '';
      const w = Number(o.weight);
      if (!provider) throw new BadRequestException('weighted_targets: provider is required');
      if (!Number.isFinite(w) || w <= 0) throw new BadRequestException(`weighted_targets: weight must be > 0 for ${provider}`);
    }
  }

  private validatePrimaryFallbackFields(body: Record<string, unknown>) {
    const fb = body.fallback_provider != null ? String(body.fallback_provider).trim() : '';
    if (!fb) return;
    const pw = body.primary_weight != null ? Number(body.primary_weight) : 100;
    const fw = body.fallback_weight != null ? Number(body.fallback_weight) : 0;
    if (!Number.isFinite(pw) || !Number.isFinite(fw) || pw < 0 || fw < 0) {
      throw new BadRequestException('primary_weight and fallback_weight must be non-negative numbers');
    }
    if (pw + fw <= 0) {
      throw new BadRequestException('primary_weight + fallback_weight must be > 0 when fallback_provider is set');
    }
  }

  private validateLatencyTargets(raw: unknown) {
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new BadRequestException('latency_targets must be an array with at least 2 providers');
    }
    for (const item of raw) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new BadRequestException('latency_targets: each item must be a non-empty provider name string');
      }
    }
  }

  private validateCostTargets(raw: unknown) {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('cost_targets must be a non-empty array');
    }
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('cost_targets: each item must be { provider, costPerUnit }');
      }
      const o = item as { provider?: unknown; costPerUnit?: unknown };
      const provider = o.provider != null ? String(o.provider).trim() : '';
      if (!provider) {
        throw new BadRequestException('cost_targets: provider is required');
      }
      const cost = Number(o.costPerUnit);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new BadRequestException(`cost_targets: costPerUnit must be a non-negative number for ${provider}`);
      }
    }
  }
}

function parseOptionalNonNegNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
