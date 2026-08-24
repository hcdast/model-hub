/*
 * 工作流模板 Controller
 * 提供公开模板列表查询 API
 */
import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiOkResponse,
} from '@nestjs/swagger';
import { WorkflowTemplateService } from './workflow-template.service';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';

@ApiTags('工作流模板')
@ApiSecurity('ApiKey')
@Controller('v1/workflow-templates')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class WorkflowTemplateController {
  constructor(private readonly templateService: WorkflowTemplateService) {}

  /**
   * 查询公开模板列表
   */
  @Get()
  @ApiOperation({
    summary: '公开模板列表',
    description: '查询所有公开的工作流模板',
  })
  @ApiOkResponse({ description: '查询成功，返回分页数据' })
  async list(
    @Query() query: {
      category?: string;
      tags?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const tags = query.tags ? query.tags.split(',') : undefined;
    const data = await this.templateService.listPublic({
      ...query,
      tags,
    });
    return { code: 0, message: 'Success', data };
  }
}
