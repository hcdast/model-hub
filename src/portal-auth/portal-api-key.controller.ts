/*
 * Portal API Key Controller
 * 开发者门户 API Key 管理 API
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalUserId } from './decorators/portal-user.decorator';
import { PortalApiKeyService } from './portal-api-key.service';

// ==================== DTOs ====================

class RateLimitDto {
  @ApiProperty({ description: '最大 QPS', required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  maxQps?: number;

  @ApiProperty({ description: '每日最大请求数', required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000000)
  maxDailyRequests?: number;
}

class CreateApiKeyDto {
  @ApiProperty({ description: 'API Key 名称', example: 'My App' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;


  @ApiProperty({ description: '过期时间', required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({ description: '速率限制', required: false, type: RateLimitDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateLimitDto)
  rateLimit?: RateLimitDto;
}

class UpdateApiKeyDto {
  @ApiProperty({ description: '名称', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '是否启用', required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;


  @ApiProperty({ description: '速率限制', required: false, type: RateLimitDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateLimitDto)
  rateLimit?: RateLimitDto;
}

// ==================== Controller ====================

@ApiTags('Portal API Key 管理')
@Controller('v1/api-keys')
@UseGuards(PortalJwtGuard)
@ApiBearerAuth()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PortalApiKeyController {
  constructor(private readonly apiKeyService: PortalApiKeyService) {}

  /**
   * 获取当前用户的限制信息
   */
  @Get('limits')
  @ApiOperation({ summary: '获取用户限制', description: '获取当前用户的 API Key 和工作流限制信息' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getLimits(@PortalUserId() userId: string) {
    const limits = await this.apiKeyService.getUserLimits(userId);
    return {
      code: 0,
      message: 'Success',
      data: limits,
    };
  }

  /**
   * 获取 API Key 列表
   */
  @Get()
  @ApiOperation({ summary: '获取 API Key 列表', description: '获取当前用户的所有 API Key' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(@PortalUserId() userId: string) {
    const keys = await this.apiKeyService.listByUser(userId);
    return {
      code: 0,
      message: 'Success',
      data: keys,
    };
  }

  /**
   * 创建 API Key
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建 API Key', description: '创建新的 API Key（仅创建时返回完整 Key）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(
    @PortalUserId() userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    const result = await this.apiKeyService.create(
      userId,
      dto.name,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      dto.rateLimit,
    );

    return {
      code: 0,
      message: 'API Key created. Please save it now, it will not be shown again.',
      data: result,
    };
  }

  /**
   * 更新 API Key
   */
  @Put(':id')
  @ApiOperation({ summary: '更新 API Key', description: '更新 API Key 的名称、状态或速率限制' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async update(
    @PortalUserId() userId: string,
    @Param('id') keyId: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    const result = await this.apiKeyService.update(userId, keyId, dto);
    return {
      code: 0,
      message: 'API Key updated',
      data: result,
    };
  }

  /**
   * 删除 API Key
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 API Key', description: '删除指定的 API Key' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async delete(
    @PortalUserId() userId: string,
    @Param('id') keyId: string,
  ) {
    await this.apiKeyService.delete(userId, keyId);
    return {
      code: 0,
      message: 'API Key deleted',
    };
  }
}
