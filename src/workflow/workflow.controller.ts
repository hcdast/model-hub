/*
 * Workflow Controller
 * 工作流 CRUD API 端点
 */
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { WorkflowService } from './workflow.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ListWorkflowQueryDto } from './dto/create-workflow.dto';
import {
  CreateWorkflowDto,
  UpdateWorkflowDto,
} from './dto/update-workflow.dto';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { ExecutionGraphResolver } from './execution-graph.resolver';
import { ValidationResult } from './interfaces/execution-graph.interface';
import { PortSchemaService } from './port-schema.service';
import { WorkflowTemplateService } from './workflow-template.service';

@ApiTags('工作流管理')
@ApiSecurity('ApiKey')
@Controller('v1/workflows')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class WorkflowController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly graphResolver: ExecutionGraphResolver,
    private readonly portSchemaService: PortSchemaService,
    private readonly templateService: WorkflowTemplateService,
  ) {}

  /**
   * 创建工作流
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建工作流', description: '创建一个新的工作流定义' })
  @ApiCreatedResponse({ description: '工作流创建成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '未授权' })
  async create(
    @Body() dto: CreateWorkflowDto,
    @ClientId() clientId: string,
  ) {
    // 确保 name 有默认值
    if (!dto.name) {
      dto.name = 'Untitled Workflow';
    }
    const data = await this.workflowService.create(dto, clientId);
    return { code: 0, message: 'Workflow created successfully', data };
  }

  /**
   * 获取工作流定义
   */
  @Get(':id')
  @ApiOperation({ summary: '获取工作流', description: '根据 ID 获取工作流定义' })
  @ApiOkResponse({ description: '查询成功' })
  @ApiResponse({ status: 404, description: '工作流不存在' })
  async get(@Param('id') id: string, @ClientId() clientId: string) {
    const data = await this.workflowService.findById(id, clientId);
    if (!data) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow not found',
      });
    }
    return { code: 0, message: 'Success', data };
  }

  /**
   * 更新工作流
   */
  @Put(':id')
  @ApiOperation({ summary: '更新工作流', description: '更新工作流定义（支持部分更新）' })
  @ApiOkResponse({ description: '更新成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 404, description: '工作流不存在' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
    @ClientId() clientId: string,
  ) {
    const data = await this.workflowService.update(id, dto, clientId);
    return { code: 0, message: 'Workflow updated successfully', data };
  }

  /**
   * 删除工作流
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除工作流', description: '删除指定工作流' })
  @ApiOkResponse({ description: '删除成功' })
  @ApiResponse({ status: 404, description: '工作流不存在' })
  async delete(@Param('id') id: string, @ClientId() clientId: string) {
    await this.workflowService.delete(id, clientId);
    return { code: 0, message: 'Workflow deleted successfully', data: null };
  }

  /**
   * 查询工作流列表
   */
  @Get()
  @ApiOperation({
    summary: '工作流列表',
    description: '分页查询工作流列表，支持按 creatorId、status、tags 筛选',
  })
  @ApiOkResponse({ description: '查询成功，返回分页数据' })
  async list(
    @Query() query: ListWorkflowQueryDto,
    @ClientId() clientId: string,
  ) {
    const data = await this.workflowService.list({
      ...query,
      creatorId: clientId,
    });
    return { code: 0, message: 'Success', data };
  }

  /**
   * 校验工作流（不保存）
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '校验工作流',
    description: '校验工作流定义的合法性，不保存。检查：必需端口已连接、无环、端口类型兼容',
  })
  @ApiOkResponse({ description: '校验完成，返回校验结果' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  async validate(@Body() dto: CreateWorkflowDto): Promise<{ code: number; message: string; data: ValidationResult }> {
    // 将 DTO 转换为 Workflow 格式
    const workflow: any = {
      ...dto,
      edges: dto.edges || [],
    };

    const result = this.graphResolver.validate(workflow);

    if (result.valid) {
      return {
        code: 0,
        message: 'Validation passed',
        data: result,
      };
    } else {
      return {
        code: 400,
        message: 'Validation failed',
        data: result,
      };
    }
  }

  /**
   * 获取模型端口 Schema
   */
  @Get('models/:modelId/port-schema')
  @ApiOperation({
    summary: '获取模型端口 Schema',
    description: '返回指定模型的输入输出端口定义',
  })
  @ApiOkResponse({ description: '查询成功' })
  @ApiResponse({ status: 404, description: '模型不存在' })
  async getModelPortSchema(@Param('modelId') modelId: string) {
    const data = await this.portSchemaService.getModelPortSchema(modelId);
    return { code: 0, message: 'Success', data };
  }

  /**
   * 从模板创建工作流
   */
  @Post('from-template/:templateId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '从模板创建工作流',
    description: '基于指定模板创建新的工作流',
  })
  @ApiCreatedResponse({ description: '工作流创建成功' })
  @ApiResponse({ status: 404, description: '模板不存在' })
  async createFromTemplate(
    @Param('templateId') templateId: string,
    @ClientId() clientId: string,
  ) {
    const template = await this.templateService.findById(templateId);
    if (!template?.isPublic) {
      throw new NotFoundException('Template not found');
    }

    const data = await this.workflowService.create(
      {
        name: `${template.name} (副本)`,
        description: template.description,
        nodes: template.workflowDefinition.nodes,
        edges: template.workflowDefinition.edges,
        viewport: template.workflowDefinition.viewport,
        inputSchema: template.workflowDefinition.inputSchema,
        outputMapping: template.workflowDefinition.outputMapping,
        executionConfig: template.workflowDefinition.executionConfig,
        tags: template.tags,
      },
      clientId,
    );

    return { code: 0, message: 'Workflow created from template', data };
  }
}
