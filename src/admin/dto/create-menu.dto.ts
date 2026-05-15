import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, IsNumber, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMenuDto {
  @ApiProperty({ description: '菜单唯一标识（kebab-case）', example: 'tasks' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Key can only contain letters, numbers, underscores, and hyphens',
  })
  key!: string;

  @ApiProperty({ description: '显示名称', example: '任务记录' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiPropertyOptional({ description: '路由路径', example: '/tasks' })
  @IsString()
  @IsOptional()
  path?: string;

  @ApiProperty({ description: 'Ant Design 图标名称', example: 'FileTextOutlined' })
  @IsString()
  @IsNotEmpty()
  icon!: string;

  @ApiPropertyOptional({ description: '排序权重（越小越靠前）', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '父级菜单 key', example: 'business' })
  @IsString()
  @IsOptional()
  parentKey?: string;

  @ApiPropertyOptional({ description: '所需权限代码', example: 'task:read' })
  @IsString()
  @IsOptional()
  requiredPermission?: string;

  @ApiPropertyOptional({ description: '关联权限列表', example: ['task:read', 'task:create'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  associatedPermissions?: string[];

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '关联功能模块 key', example: 'task' })
  @IsString()
  @IsOptional()
  moduleKey?: string;
}
