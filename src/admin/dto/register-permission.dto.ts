import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterPermissionDto {
  @ApiProperty({ description: '权限代码（resource:action 格式）', example: 'model:create' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z-]+:[a-z-]+$/, {
    message: 'Permission code must follow the format "resource:action"',
  })
  code!: string;

  @ApiProperty({ description: '资源类型', example: 'model' })
  @IsString()
  @IsNotEmpty()
  resource!: string;

  @ApiProperty({ description: '操作类型', example: 'create' })
  @IsString()
  @IsNotEmpty()
  action!: string;

  @ApiProperty({ description: '显示名称', example: '创建模型配置' })
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional({ description: '权限描述', example: '允许创建新的模型配置' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '所属模块', example: 'model-management' })
  @IsString()
  @IsNotEmpty()
  module!: string;
}
