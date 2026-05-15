import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StatsService } from '../stats/stats.service';
import { QueueStatsCollectorService } from '../stats/queue-stats-collector.service';
import { QueueRegistryService } from '../queue/queue-registry.service';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { BillingService } from '../billing/billing.service';

@ApiTags('管理后台 - 统计监控')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminStatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly queueStatsCollector: QueueStatsCollectorService,
    private readonly queueRegistry: QueueRegistryService,
    private readonly billingService: BillingService,
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
  ) {}

  @Get('stats/daily')
  @RequirePermissions('stats:read')
  @ApiOperation({ summary: '每日统计报表', description: '按功能、供应商、模型维度的每日聚合统计' })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2026-04-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2026-04-07' })
  @ApiQuery({ name: 'featureType', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getDailyStats(
    @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string,
    @Query('featureType') featureType?: string, @Query('provider') provider?: string,
    @Query('page') page = '1', @Query('pageSize') pageSize = '50',
  ) {
    const result = await this.statsService.queryDaily(
      { dateFrom, dateTo, featureType, provider },
      parseInt(page, 10) || 1, Math.min(100, parseInt(pageSize, 10) || 50),
    );
    return { code: 0, data: result };
  }

  @Get('queues/stats')
  @RequirePermissions('queue:read')
  @ApiOperation({ summary: '队列实时状态', description: '获取所有队列的最新快照（等待/处理中/已完成/深度/吞吐量）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getQueueStats() {
    const stats = await this.queueStatsCollector.getLatestStats();
    return { code: 0, data: { queues: stats, snapshotAt: new Date() } };
  }

  @Get('queues/stats/history')
  @RequirePermissions('queue:read')
  @ApiOperation({ summary: '队列历史趋势', description: '获取指定队列的历史快照数据' })
  @ApiQuery({ name: 'queueName', required: true, example: 'image-generate:wavespeed-ai' })
  @ApiQuery({ name: 'from', required: true, example: '2026-04-07T00:00:00Z' })
  @ApiQuery({ name: 'to', required: true, example: '2026-04-07T23:59:59Z' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getQueueHistory(
    @Query('queueName') queueName: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!queueName || !from || !to) return { code: 1001, message: 'queueName, from, to are required' };
    const history = await this.queueStatsCollector.getHistory(queueName, new Date(from), new Date(to));
    return { code: 0, data: history };
  }

  @Get('overview')
  @RequirePermissions('stats:read')
  @ApiOperation({ summary: 'Dashboard 总览', description: '今日核心指标概览（任务量、成功率、队列深度）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getOverview() {
    // 并行调用三个数据源，减少接口响应时间
    const [totalStats, todayStats, queueStats] = await Promise.all([
      this.statsService.getAllTimeStats(),
      this.statsService.getTodayRealtimeStats(),
      this.queueStatsCollector.getLatestStats(),
    ]);

    return {
      code: 0,
      data: {
        today: todayStats,
        total: totalStats,
        queues: {
          totalDepth: queueStats.reduce((s, q) => s + (q.depth || 0), 0),
          totalActive: queueStats.reduce((s, q) => s + (q.active || 0), 0),
        },
        snapshotAt: new Date(),
      },
    };
  }

  @Get('cost-overview')
  @RequirePermissions('stats:read')
  @ApiOperation({ summary: '成本分析总览', description: '今日成本核心指标：模型消耗、热门模型' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getCostOverview() {
    const costData = await this.billingService.getTodayCostOverview();
    return { code: 0, data: costData };
  }

  @Get('queues/:queueName/jobs')
  @RequirePermissions('queue:read')
  @ApiOperation({ summary: '队列 Job 列表', description: '获取指定队列中 waiting/active 的任务列表' })
  @ApiParam({ name: 'queueName', description: '队列名称', example: 'image-generate:wavespeed-ai' })
  @ApiQuery({ name: 'status', required: false, enum: ['waiting', 'active'], example: 'waiting' })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, example: '20' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '队列不存在' })
  async getQueueJobs(
    @Param('queueName') queueName: string,
    @Query('status') status: 'waiting' | 'active' = 'waiting',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const queue = this.queueRegistry.getQueue(queueName);
    if (!queue) {
      throw new NotFoundException(`Queue "${queueName}" not found`);
    }

    const jobs = status === 'active' ? await queue.getActive() : await queue.getWaiting();

    // Extract job data
    const jobItems = jobs.map((job) => ({
      jobId: String(job.id),
      taskId: job.data?.taskId ?? null,
      model: job.data?.model ?? job.data?.modelName ?? null,
      priority: job.opts?.priority ?? null,
      apiKey: job.data?.apiKey ?? null,
      enqueuedAt: job.timestamp ?? null,
    }));

    // Paginate
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const total = jobItems.length;
    const paged = jobItems.slice((p - 1) * ps, p * ps);

    // Attach client names
    const apiKeys = [...new Set(paged.map((j) => j.apiKey).filter(Boolean))] as string[];
    const clientNameMap = new Map<string, string | null>();
    if (apiKeys.length > 0) {
      const clients = await this.apiClientModel
        .find({ apiKey: { $in: apiKeys } })
        .select('apiKey name')
        .lean();
      for (const c of clients) {
        clientNameMap.set(c.apiKey, c.name?.trim() || null);
      }
    }

    const items = paged.map((j) => ({
      ...j,
      clientName: j.apiKey ? (clientNameMap.get(j.apiKey) ?? null) : null,
    }));

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }
}
