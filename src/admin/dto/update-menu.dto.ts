import { IsString, IsOptional, IsArray, IsBoolean, IsNumber, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMenuDto {
  @ApiPropertyOptional({ description: '显示名称', example: '任务记录' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({ description: '路由路径', example: '/tasks' })
  @IsString()
  @IsOptional()
  path?: string;

  @ApiPropertyOptional({ description: 'Ant Design 图标名称', example: 'FileTextOutlined' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ description: '排序权重（越小越靠前）' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '父级菜单 key' })
  @IsString()
  @IsOptional()
  parentKey?: string;

  @ApiPropertyOptional({ description: '所需权限代码' })
  @IsString()
  @IsOptional()
  requiredPermission?: string;

  @ApiPropertyOptional({ description: '关联权限列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  associatedPermissions?: string[];

  @ApiPropertyOptional({ description: '是否启用' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '关联功能模块 key' })
  @IsString()
  @IsOptional()
  moduleKey?: string;
}
