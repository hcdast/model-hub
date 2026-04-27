import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ description: '角色名称（字母、数字、下划线、连字符）', example: 'content_editor', minLength: 2, maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Role name can only contain letters, numbers, underscores, and hyphens',
  })
  name!: string;

  @ApiProperty({ description: '显示名称', example: '内容编辑' })
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional({ description: '角色描述', example: '负责内容编辑和审核' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: '权限列表（resource:action 格式）', example: ['model:read', 'model:update'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-z-]+:[a-z-]+$/, { each: true, message: 'Each permission must follow the format "resource:action"' })
  @IsOptional()
  permissions?: string[];

  @ApiPropertyOptional({ description: '是否为系统角色', default: false })
  @IsBoolean()
  @IsOptional()
  isSystem?: boolean;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
