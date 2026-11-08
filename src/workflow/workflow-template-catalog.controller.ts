import { Controller, Get, NotFoundException, Optional, Param, Query } from '@nestjs/common';
import { emptyTemplateMetrics, TemplateInsightsService } from '../creation/template-insights.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { isValidObjectId } from 'mongoose';
import { WorkflowTemplateService } from './workflow-template.service';
import { templateCatalogEntry } from './workflow-template-catalog';
import { ListTemplateCatalogDto } from './dto/workflow-template.dto';

@ApiTags('公开工作流模板目录')
@Controller('v1/catalog/workflow-templates')
export class WorkflowTemplateCatalogController {
  constructor(private readonly templates: WorkflowTemplateService, @Optional() private readonly insights?: TemplateInsightsService) {}

  @Get()
  @ApiOperation({ summary: '浏览已发布模板（无需登录）' })
  async list(@Query() query: ListTemplateCatalogDto) {
    const result = await this.templates.listPublic(query);
    const stats = await this.insights?.metrics('workflow');
    return { ...result, computedAt: stats ? new Date(stats.at).toISOString() : undefined, items: result.items.map(item => ({ ...templateCatalogEntry(item.toObject()), metrics: stats?.metrics.get(String(item._id)) || emptyTemplateMetrics() })) };
  }

  @Get(':id')
  @ApiOperation({ summary: '公开模板详情及只读工作流预览（无需登录）' })
  async detail(@Param('id') id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Template not found');
    const template = await this.templates.findById(id);
    if (!template?.isPublic) throw new NotFoundException('Template not found');
    return { ...templateCatalogEntry(template.toObject(), true), compatibility: await this.templates.compatibility(template) };
  }
}
