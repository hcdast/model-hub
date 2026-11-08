import { Body, Controller, Get, Param, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsMongoId, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { DramaWorkflowService } from './drama-workflow.service';
class CreateShotWorkflowDto {
  @IsOptional() @IsMongoId() templateId?: string;
  @IsUUID() projectId!: string;
  @IsString() @MaxLength(64) shotId!: string;
  @IsIn(['image', 'video']) kind!: 'image' | 'video';
  @IsInt() @Min(0) revision!: number;
}
class ImportShotOutputDto { @IsString() @MaxLength(100) runId!: string; @IsString() @MaxLength(100) nodeId!: string }
@Controller('v1/drama-workflows')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DramaWorkflowController {
  constructor(private readonly service: DramaWorkflowService) {}
  @Post() create(@ClientId() owner: string, @Body() dto: CreateShotWorkflowDto) { return this.service.create(owner, dto); }
  @Get('by-workflow/:workflowId') get(@ClientId() owner: string, @Param('workflowId') workflowId: string) { return this.service.forWorkflow(owner, workflowId); }
  @Post(':id/import') import(@ClientId() owner: string, @Param('id') id: string, @Body() dto: ImportShotOutputDto) { return this.service.importOutput(owner, id, dto); }
}
