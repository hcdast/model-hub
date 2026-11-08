import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ClientId } from '../auth/decorators/client-info.decorator';
import { WORKFLOW_ASSET_MAX_BYTES, WorkflowAssetService } from './workflow-asset.service';

class AssetListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
}

class SaveOutputDto {
  @IsString() @MinLength(1) @MaxLength(128) workflowId!: string;
  @IsString() @MinLength(1) @MaxLength(128) runId!: string;
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsOptional() @IsString() @MaxLength(180) name?: string;
}

class UploadAssetDto {
  @IsOptional() @IsIn(['workflow', 'short-drama']) feature?: 'workflow' | 'short-drama';
}

@Controller('v1/workflow-assets')
@UseGuards(ApiKeyOrJwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class WorkflowAssetController {
  constructor(private readonly assets: WorkflowAssetService) {}

  @Get()
  async list(@ClientId() ownerId: string, @Query() query: AssetListQuery) {
    return { code: 0, message: 'Success', data: await this.assets.list(ownerId, query.page, query.pageSize) };
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: WORKFLOW_ASSET_MAX_BYTES, files: 1, fields: 1, fieldSize: 32 } }))
  async upload(@ClientId() ownerId: string, @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }, @Body() input: UploadAssetDto) {
    return { code: 0, message: 'Success', data: await this.assets.upload(ownerId, file, input.feature === 'short-drama' ? 'drama-upload' : 'upload') };
  }

  @Post('from-output')
  async fromOutput(@ClientId() ownerId: string, @Body() input: SaveOutputDto) {
    return { code: 0, message: 'Success', data: await this.assets.fromOutput(ownerId, input) };
  }

  @Delete(':id')
  async delete(@ClientId() ownerId: string, @Param('id') id: string) {
    return { code: 0, message: '素材记录已删除；已引用的存储链接不会撤销', data: await this.assets.delete(ownerId, id) };
  }
}
