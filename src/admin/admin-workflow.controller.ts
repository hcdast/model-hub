/*
 * 管理后台工作流 Controller
 * 提供工作流和模板的管理 API
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { WorkflowExecutionService } from '../workflow/workflow-execution.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 工作流管理')
@ApiBearerAuth()
@Controller('api/v1/admin/workflows')
@UseGuards(AdminJwtGuard, PermissionGuard, RolesGuard)
@Roles('admin')
export class AdminWorkflowController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly templateService: WorkflowTemplateService,
    private readonly executionService: WorkflowExecutionService,
  ) {}

  // ==================== 工作流管理 ====================

  /**
   * 工作流列表
   */
  @Get()
  @RequirePermissions('workflow:read')
  @ApiOperation({ summary: '工作流列表', description: '分页查询所有工作流' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listWorkflows(
    @Query() query: {
      creatorId?: string;
      status?: string;
      tags?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const tags = query.tags ? query.tags.split(',') : undefined;
    const data = await this.workflowService.list({ ...query, tags });
    return { code: 0, message: 'Success', data };
  }


  /**
   * 启用工作流
   */
  @Put(':id/activate')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '启用工作流', description: '将工作流状态设置为 active' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async activateWorkflow(@Param('id') id: string) {
    const data = await this.workflowService.update(id, { status: 'active' });
    return { code: 0, message: 'Workflow activated', data };
  }

  /**
   * 禁用工作流
   */
  @Put(':id/deactivate')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '禁用工作流', description: '将工作流状态设置为 draft' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async deactivateWorkflow(@Param('id') id: string) {
    const data = await this.workflowService.update(id, { status: 'draft' });
    return { code: 0, message: 'Workflow deactivated', data };
  }

  /**
   * 归档工作流
   */
  @Put(':id/archive')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '归档工作流', description: '将工作流状态设置为 archived' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async archiveWorkflow(@Param('id') id: string) {
    const data = await this.workflowService.update(id, { status: 'archived' });
    return { code: 0, message: 'Workflow archived', data };
  }

  /**
   * 删除工作流
   */
  @Delete(':id')
  @RequirePermissions('workflow:delete')
  @ApiOperation({ summary: '删除工作流', description: '永久删除工作流' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async deleteWorkflow(@Param('id') id: string) {
    await this.workflowService.delete(id);
    return { code: 0, message: 'Workflow deleted', data: null };
  }

  // ==================== 模板管理 ====================

  /**
   * 模板列表（管理后台）
   */
  @Get('templates')
  @RequirePermissions('workflow:read')
  @ApiOperation({ summary: '模板列表', description: '查询所有模板（包括未公开）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listTemplates(
    @Query() query: {
      category?: string;
      isPublic?: boolean;
      page?: number;
      pageSize?: number;
    },
  ) {
    // 管理后台可以查看所有模板
    const data = await this.templateService.listPublic(query);
    return { code: 0, message: 'Success', data };
  }

  /**
   * 创建模板
   */
  @Post('templates')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '创建模板', description: '创建新的工作流模板' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async createTemplate(
    @Body()
    dto: {
      name: string;
      description?: string;
      category: string;
      tags?: string[];
      thumbnail?: string;
      workflowDefinition: any;
    },
  ) {
    const data = await this.templateService.create(dto);
    return { code: 0, message: 'Template created', data };
  }

  /**
   * 更新模板
   */
  @Put('templates/:id')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '更新模板', description: '更新模板信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<{
      name: string;
      description: string;
      category: string;
      tags: string[];
      thumbnail: string;
      workflowDefinition: any;
    }>,
  ) {
    const data = await this.templateService.update(id, dto);
    return { code: 0, message: 'Template updated', data };
  }

  /**
   * 删除模板
   */
  @Delete('templates/:id')
  @RequirePermissions('workflow:delete')
  @ApiOperation({ summary: '删除模板', description: '永久删除模板' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async deleteTemplate(@Param('id') id: string) {
    await this.templateService.delete(id);
    return { code: 0, message: 'Template deleted', data: null };
  }

  /**
   * 发布模板
   */
  @Put('templates/:id/publish')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '发布模板', description: '将模板设置为公开' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async publishTemplate(@Param('id') id: string) {
    const data = await this.templateService.publish(id);
    return { code: 0, message: 'Template published', data };
  }

  /**
   * 取消发布模板
   */
  @Put('templates/:id/unpublish')
  @RequirePermissions('workflow:update')
  @ApiOperation({ summary: '取消发布模板', description: '将模板设置为不公开' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async unpublishTemplate(@Param('id') id: string) {
    const data = await this.templateService.unpublish(id);
    return { code: 0, message: 'Template unpublished', data };
  }

  // ==================== 执行历史 ====================

  /**
   * 执行历史列表
   */
  @Get('runs')
  @RequirePermissions('workflow:read')
  @ApiOperation({ summary: '执行历史列表', description: '查询工作流执行历史' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listRuns(
    @Query() query: {
      workflowId?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const data = await this.executionService.listRuns(query);
    return { code: 0, message: 'Success', data };
  }
  /**
   * 工作流详情
   */
  @Get(':id')
  @RequirePermissions('workflow:read')
  @ApiOperation({ summary: '工作流详情', description: '获取工作流详细信息' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '工作流不存在' })
  async getWorkflow(@Param('id') id: string) {
    const data = await this.workflowService.findById(id);
    if (!data) {
      throw new NotFoundException('Workflow not found');
    }
    return { code: 0, message: 'Success', data };
  }
}
