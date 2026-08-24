/*
 * 工作流执行 Controller
 * 提供执行触发、状态查询、取消、重试等 API
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  Sse,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiOkResponse,
} from '@nestjs/swagger';
import { WorkflowExecutionService } from './workflow-execution.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { Client, ClientId, ClientInfo } from '../auth/decorators/client-info.decorator';
import { Observable, fromEvent, map, from, switchMap } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface WorkflowRunEvent {
  runId: string;
  nodeId?: string;
  status?: string;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

@ApiTags('工作流执行')
@ApiSecurity('ApiKey')
@Controller('v1/workflows')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class WorkflowRunController {
  constructor(
    private readonly executionService: WorkflowExecutionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 单节点执行
   */
  @Post(':workflowId/nodes/:nodeId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '单节点执行',
    description: '仅执行工作流中的指定节点及其上游依赖',
  })
  @ApiResponse({ status: 202, description: '节点执行已触发' })
  async runNode(
    @Param('workflowId') workflowId: string,
    @Param('nodeId') nodeId: string,
    @Body() input: Record<string, unknown>,
    @ClientId() clientId: string,
    @Client() client: ClientInfo,
  ) {
    const data = await this.executionService.runNode(
      workflowId,
      nodeId,
      input,
      clientId,
      client.apiKey,
    );
    return { code: 0, message: 'Node execution triggered', data };
  }

  /**
   * 触发工作流执行
   */
  @Post(':id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '触发工作流执行',
    description: '触发指定工作流的执行，返回执行实例 ID。可通过 body.nodeIds 指定仅执行部分节点',
  })
  @ApiResponse({ status: 202, description: '执行已触发' })
  @ApiResponse({ status: 404, description: '工作流不存在' })
  @ApiResponse({ status: 400, description: '工作流校验失败' })
  async run(
    @Param('id') id: string,
    @Body() input: Record<string, unknown> & { nodeIds?: string[] },
    @ClientId() clientId: string,
    @Client() client: ClientInfo,
  ) {
    const { nodeIds, ...runInput } = input;
    const data = await this.executionService.run(
      id,
      runInput,
      clientId,
      nodeIds,
      client.apiKey,
    );
    return { code: 0, message: 'Workflow execution triggered', data };
  }

  /**
   * 查询执行状态
   */
  @Get('runs/:runId')
  @ApiOperation({
    summary: '查询执行状态',
    description: '查询工作流执行实例的状态和各节点执行结果',
  })
  @ApiOkResponse({ description: '查询成功' })
  @ApiResponse({ status: 404, description: '执行实例不存在' })
  async getStatus(
    @Param('runId') runId: string,
    @ClientId() clientId: string,
  ) {
    const data = await this.executionService.getStatus(runId, clientId);
    if (!data) {
      throw new NotFoundException('Run not found');
    }
    return { code: 0, message: 'Success', data };
  }

  /**
   * SSE 实时推送
   */
  @Sse('runs/:runId/stream')
  @ApiOperation({
    summary: 'SSE 实时推送',
    description: '通过 SSE 实时推送节点状态变化事件',
  })
  stream(
    @Param('runId') runId: string,
    @ClientId() clientId: string,
  ): Observable<MessageEvent> {
    return from(this.executionService.getStatus(runId, clientId)).pipe(
      switchMap((run) => {
        if (!run) throw new NotFoundException('Run not found');
        return fromEvent<WorkflowRunEvent>(
          this.eventEmitter,
          `workflow.run.${runId}`,
        ).pipe(
          map((event) => ({
            data: event,
          }) as MessageEvent),
        );
      }),
    );
  }

  /**
   * 取消执行
   */
  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '取消执行',
    description: '取消正在进行的工作流执行',
  })
  @ApiOkResponse({ description: '取消成功' })
  @ApiResponse({ status: 404, description: '执行实例不存在' })
  @ApiResponse({ status: 409, description: '当前状态不允许取消' })
  async cancel(
    @Param('runId') runId: string,
    @ClientId() clientId: string,
  ) {
    await this.executionService.cancel(runId, clientId);
    return { code: 0, message: 'Workflow execution cancelled', data: null };
  }

  /**
   * 重试失败节点
   */
  @Post('runs/:runId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '重试失败节点',
    description: '重试指定或所有失败的节点',
  })
  @ApiOkResponse({ description: '重试已触发' })
  @ApiResponse({ status: 404, description: '执行实例不存在' })
  async retry(
    @Param('runId') runId: string,
    @Body() body: { nodeIds?: string[] },
    @ClientId() clientId: string,
  ) {
    await this.executionService.retry(runId, clientId, body.nodeIds);
    return { code: 0, message: 'Retry triggered', data: null };
  }

  /**
   * 节点执行详情
   */
  @Get('runs/:runId/nodes/:nodeId')
  @ApiOperation({
    summary: '节点执行详情',
    description: '查询指定节点的执行详情',
  })
  @ApiOkResponse({ description: '查询成功' })
  @ApiResponse({ status: 404, description: '执行实例或节点不存在' })
  async getNodeDetail(
    @Param('runId') runId: string,
    @Param('nodeId') nodeId: string,
    @ClientId() clientId: string,
  ) {
    const run = await this.executionService.getStatus(runId, clientId);
    if (!run) {
      throw new NotFoundException('Run not found');
    }

    const nodeState = run.nodeStates.find((n) => n.nodeId === nodeId);
    if (!nodeState) {
      throw new NotFoundException('Node not found');
    }

    return { code: 0, message: 'Success', data: nodeState };
  }
}
