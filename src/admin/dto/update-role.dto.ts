import { IsString, IsOptional, IsArray, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '显示名称', example: '内容编辑', minLength: 2, maxLength: 50 })
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  displayName?: string;

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

  @ApiPropertyOptional({ description: '是否启用' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
