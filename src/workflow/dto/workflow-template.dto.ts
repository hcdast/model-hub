import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CreateWorkflowDto } from './update-workflow.dto';

export const templateScenarios = ['ecommerce', 'marketing', 'character', 'video', 'audio', 'image'] as const;

export class TemplateExampleDto {
  @IsString() @MinLength(1) @MaxLength(100)
  title!: string;

  @IsIn(['image', 'video', 'audio'])
  mediaType!: 'image' | 'video' | 'audio';

  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false }) @MaxLength(2000)
  outputUrl!: string;

  @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false }) @MaxLength(2000)
  inputUrl?: string;

  @IsOptional() @IsIn(['image', 'video', 'audio'])
  inputMediaType?: 'image' | 'video' | 'audio';

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;
}

/** Publication metadata is curated through the existing admin-only template API. */
export class CreateWorkflowTemplateDto {
  @IsString() @MinLength(1) @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsString() @MinLength(1) @MaxLength(100)
  category!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true })
  tags?: string[];

  @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false }) @MaxLength(2000)
  thumbnail?: string;

  @IsObject() @ValidateNested() @Type(() => CreateWorkflowDto)
  workflowDefinition!: CreateWorkflowDto;

  @IsOptional() @IsIn(['official', 'community'])
  source?: 'official' | 'community';

  @IsOptional() @IsIn(templateScenarios)
  scenario?: typeof templateScenarios[number];

  @IsOptional() @IsString() @MaxLength(100)
  authorName?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  instructions?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => TemplateExampleDto)
  examples?: TemplateExampleDto[];
}

export class UpdateWorkflowTemplateDto extends PartialType(CreateWorkflowTemplateDto) {}

export class ListTemplateCatalogDto {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsIn(['official', 'community'])
  source?: 'official' | 'community';

  @IsOptional() @IsIn(templateScenarios)
  scenario?: typeof templateScenarios[number];

  @IsOptional() @IsIn(['recommended', 'updated', 'newest', 'name'])
  order?: 'recommended' | 'updated' | 'newest' | 'name';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48)
  pageSize?: number;
}
