/*
 * @Author: huchen
 * @Date: 2026-04-06 17:58:07
 * @LastEditors: huchen
 * @LastEditTime: 2026-04-20 21:55:15
 * @FilePath: \model-hub\src\task\task.controller.ts
 * @Description: 
 * 
 * Copyright (c) 2026 by ${git_name_email}, All Rights Reserved. 
 */
import {
  Controller, Post, Get, Body, Param, Query, Headers,
  HttpCode, HttpStatus, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiSecurity } from '@nestjs/swagger';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskListQueryDto } from './dto/task-list-query.dto';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ClientRateLimitGuard } from '../auth/guards/client-rate-limit.guard';
import { ModelAllowlistGuard } from '../auth/guards/model-allowlist.guard';
import { ClientId } from '../auth/decorators/client-id.decorator';

@ApiTags('任务管理')
@ApiSecurity('ApiKey')
@Controller('v1/tasks')
@UseGuards(ApiKeyGuard, ClientRateLimitGuard, ModelAllowlistGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ 
    summary: '创建任务', 
    description: `提交 AI 模型任务，立即返回 taskId，任务异步处理。
    
路由优先级：
1. model_routing_rules (fixed/weighted/primary_fallback)
2. model_configs.service 字段映射
3. 模型路径首段兜底

支持的功能类型：
- image_generate (文生图/图生图)
- text_to_video (文生视频)
- image_to_video (图生视频)
- character_swap (角色换装)
- video_upscale (视频超分)`
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false, description: '幂等键，相同 key 不会重复创建任务' })
  @ApiResponse({ status: 202, description: '任务创建成功，返回 taskId 和路由信息' })
  @ApiResponse({ status: 400, description: '参数校验失败、不支持的模型或模型已禁用' })
  @ApiResponse({ status: 409, description: '重复提交（幂等命中）' })
  @ApiResponse({ status: 500, description: '服务器内部错误' })
  async createTask(
    @Body() dto: CreateTaskDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @ClientId() clientId: string,
  ) {
    const data = await this.taskService.createTask(clientId, dto, idempotencyKey);
    return { 
      code: 0, 
      message: 'Task created successfully', 
      data,
      meta: {
        routingSource: data.routingSource,
        routeId: data.routeId,
      }
    };
  }

  @Get(':taskId')
  @ApiOperation({ 
    summary: '查询任务', 
    description: `根据 taskId 查询任务详情，包含：
- 任务状态和结果
- 使用的 provider 和 model
- 路由信息（routeId, routingSource）
- 创建和更新时间`
  })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '任务不存在或无权访问' })
  async getTask(
    @Param('taskId') taskId: string,
    @ClientId() clientId: string,
  ) {
    const data = await this.taskService.getTask(clientId, taskId);
    return { code: 0, message: 'Success', data };
  }

  @Get()
  @ApiOperation({ 
    summary: '任务列表', 
    description: `按条件分页查询任务列表，支持筛选：
- status: 任务状态
- model: 模型标识
- provider: 厂商名称
- featureType: 功能类型
- page/pageSize: 分页参数`
  })
  @ApiResponse({ status: 200, description: '查询成功，返回分页数据' })
  async listTasks(
    @Query() query: TaskListQueryDto,
    @ClientId() clientId: string,
  ) {
    const data = await this.taskService.listTasks(clientId, query);
    return { code: 0, message: 'Success', data };
  }

  @Post(':taskId/cancel')
  @ApiOperation({ summary: '取消任务', description: '取消 PENDING 或 SUBMITTED 状态的任务' })
  @ApiResponse({ status: 200, description: '取消成功' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  @ApiResponse({ status: 409, description: '当前状态不允许取消' })
  async cancelTask(
    @Param('taskId') taskId: string,
    @ClientId() clientId: string,
  ) {
    const data = await this.taskService.cancelTask(clientId, taskId);
    return { code: 0, message: 'Task cancellation requested', data };
  }
}
