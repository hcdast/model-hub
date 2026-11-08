import { Body, Controller, Get, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { CreationTemplateService } from './creation-template.service';

class SubmitTemplateDto {
  @IsIn(['workflow', 'short-drama']) kind!: 'workflow' | 'short-drama';
  @IsString() @MaxLength(64) sourceId!: string;
  @IsString() @MinLength(1) @MaxLength(100) @Matches(/\S/) name!: string;
  @IsString() @MinLength(1) @MaxLength(2000) @Matches(/\S/) description!: string;
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) instructions!: string;
}
export class SubmissionPageDto { @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1 }
@Controller('v1/creation-templates/submissions')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CreationTemplateController {
  constructor(private readonly service: CreationTemplateService) {}
  @Post() submit(@ClientId() owner: string, @Body() dto: SubmitTemplateDto) { return this.service.submit(owner, dto); }
  @Get() list(@ClientId() owner: string, @Query() dto: SubmissionPageDto) { return this.service.list(owner, dto.page); }
}
