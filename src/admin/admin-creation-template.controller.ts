import { Body, Controller, Get, Optional, Param, Put, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreationEventService } from '../creation/creation-event.service';
import { TemplateInsightsService } from '../creation/template-insights.service';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { CreationTemplateService } from '../creation/creation-template.service';
import { SubmissionPageDto } from '../creation/creation-template.controller';
class ReviewTemplateDto {
  @IsIn(['publish', 'reject', 'withdraw']) action!: 'publish' | 'reject' | 'withdraw';
  @IsOptional() @IsString() @MaxLength(2000) note = '';
}
class TemplateInsightsQuery extends SubmissionPageDto {
  @IsOptional() @IsIn(['workflow', 'short-drama']) kind: 'workflow' | 'short-drama' = 'short-drama';
}
@Controller('api/v1/admin/creation-templates')
@UseGuards(AdminJwtGuard, PermissionGuard, RolesGuard)
@Roles('admin', 'super_admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminCreationTemplateController {
  constructor(private readonly service: CreationTemplateService, private readonly insights: TemplateInsightsService, @Optional() private readonly events?: CreationEventService) {}
  @Get('funnel') @RequirePermissions('workflow:read') funnel(@Query() dto: TemplateInsightsQuery) { return this.events?.funnel(dto.kind); }
  @Get('insights') @RequirePermissions('workflow:read') metrics(@Query() dto: TemplateInsightsQuery) { return this.insights.overview(dto.kind, dto.page); }
  @Get() @RequirePermissions('workflow:read') list(@Query() dto: SubmissionPageDto) { return this.service.list(undefined, dto.page); }
  @Get(':id') @RequirePermissions('workflow:read') detail(@Param('id') id: string) { return this.service.detail(id); }
  @Put(':id/review') @RequirePermissions('workflow:update') review(@Param('id') id: string, @Body() dto: ReviewTemplateDto) { return this.service.review(id, dto.action, dto.note); }
}
