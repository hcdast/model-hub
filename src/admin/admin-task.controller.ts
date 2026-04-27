import { Controller, Get, Post, Put, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model } from 'mongoose';
import { Queue } from 'bull';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AuditLogService } from './audit-log.service';
import { TaskTimelineService } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import { TaskService } from '../task/task.service';
import { Request } from 'express';

@ApiTags('管理后台 - 任务管理')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/tasks')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminTaskController {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
    private readonly auditLogService: AuditLogService,
    private readonly timelineService: TaskTimelineService,
    private readonly timingService: TaskTimingService,
    private readonly taskService: TaskService,
  ) {}

  @Get()
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务列表（管理端）', description: '支持按状态、厂商、功能类型、模型筛选' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'featureType', required: false })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, example: '20' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listTasks(
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('featureType') featureType?: string,
    @Query('model') model?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const query: any = {};
    if (status) query.status = status;
    if (provider) query.provider = provider;
    if (featureType) query.featureType = featureType;
    if (model) query.model = model;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [rawItems, total] = await Promise.all([
      this.taskModel.find(query).sort({ createdAt: -1 }).skip((p - 1) * ps).limit(ps).lean(),
      this.taskModel.countDocuments(query),
    ]);

    const items = await this.attachClientDisplayNames(rawItems);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Get(':taskId')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务详情（管理端）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTask(@Param('taskId') taskId: string) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };
    const [enriched] = await this.attachClientDisplayNames([task]);
    return { code: 0, data: enriched };
  }

  @Get(':taskId/timeline')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务时间线', description: '获取任务完整的生命周期事件时间线' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTimeline(@Param('taskId') taskId: string) {
    const timeline = await this.timelineService.getTimeline(taskId);
    return { code: 0, data: { taskId, timeline } };
  }

  @Get(':taskId/timing')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务时长指标', description: '获取任务各阶段精确时间点和计算时长' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTiming(@Param('taskId') taskId: string) {
    const timing = await this.timingService.getTiming(taskId);
    return { code: 0, data: { taskId, timing } };
  }

  @Post(':taskId/replay-callback')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '回调重放', description: '重新发送指定任务的回调' })
  @ApiResponse({ status: 200, description: '已入队' })
  async replayCallback(@Param('taskId') taskId: string, @Req() req: Request) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };
    if (!task.callback?.url) return { code: 1001, message: 'No callback URL configured' };

    await this.callbackQueue.add('deliver', { taskId, callbackUrl: task.callback.url, callbackSecret: task.callback.secret });
    const adminUser = (req as any).adminUser;
    await this.auditLogService.log('REPLAY_CALLBACK', adminUser?.username || 'unknown', { taskId });
    return { code: 0, message: 'Callback replay enqueued' };
  }

  @Post(':taskId/cancel')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '管理员取消任务', description: '取消 PENDING 或 SUBMITTED 状态的任务' })
  @ApiResponse({ status: 200, description: '取消成功' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  @ApiResponse({ status: 409, description: '当前状态不允许取消' })
  async adminCancelTask(@Param('taskId') taskId: string, @Req() req: Request) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };
    const adminUser = (req as any).adminUser;
    const adminUsername = adminUser?.username || 'unknown';
    const data = await this.taskService.cancelTask(task.clientId, taskId, adminUsername);
    await this.auditLogService.log('CANCEL_TASK', adminUsername, { taskId, previousStatus: task.status });
    return { code: 0, data };
  }

  @Put(':taskId/priority')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '调整任务优先级', description: '动态调整 PENDING 状态任务的优先级' })
  @ApiResponse({ status: 200, description: '调整成功' })
  @ApiResponse({ status: 409, description: '任务状态不允许调整优先级' })
  async updatePriority(
    @Param('taskId') taskId: string,
    @Body() body: { priority: number },
    @Req() req: Request,
  ) {
    const adminUser = (req as any).adminUser;
    const adminUsername = adminUser?.username || 'unknown';
    const result = await this.taskService.updatePriority(taskId, body.priority, adminUsername);
    await this.auditLogService.log('UPDATE_TASK_PRIORITY', adminUsername, {
      taskId,
      oldPriority: result.oldPriority,
      newPriority: result.newPriority,
    });
    return { code: 0, data: result };
  }

  /** 为任务列表/详情附加 api_clients.name，便于后台区分调用方 */
  private async attachClientDisplayNames<T extends { clientId?: string }>(items: T[]): Promise<Array<T & { clientName: string | null }>> {
    const ids = [...new Set(items.map((t) => t.clientId).filter((id): id is string => Boolean(id)))];
    const nameByClientId = new Map<string, string | null>();
    if (ids.length > 0) {
      const clients = await this.apiClientModel
        .find({ clientId: { $in: ids } })
        .select('clientId name')
        .lean();
      for (const c of clients) {
        nameByClientId.set(c.clientId, c.name?.trim() ? c.name.trim() : null);
      }
    }
    return items.map((t) => {
      if (!t.clientId) return { ...t, clientName: null };
      const hit = nameByClientId.has(t.clientId);
      const clientName = hit ? (nameByClientId.get(t.clientId) ?? null) : null;
      return { ...t, clientName };
    });
  }
}
