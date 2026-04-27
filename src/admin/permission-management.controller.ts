import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { RegisterPermissionDto } from './dto/register-permission.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 权限管理')
@Controller('api/v1/admin/permissions')
@UseGuards(AdminJwtGuard, PermissionGuard)
@ApiBearerAuth()
export class PermissionManagementController {
  constructor(private readonly permissionService: PermissionService) {}

  @Post()
  @RequirePermissions('permission:create')
  @ApiOperation({ summary: '注册权限（用于动态扩展）', description: '需要权限: permission:create。权限代码须符合 resource:action 格式' })
  @ApiResponse({ status: 201, description: '权限注册成功' })
  @ApiResponse({ status: 400, description: '请求参数错误（格式无效、权限已存在）' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async registerPermission(@Body() registerPermissionDto: RegisterPermissionDto) {
    const permission = await this.permissionService.registerPermission(registerPermissionDto);
    const permissionDoc = permission as any;
    return {
      code: 0,
      message: 'Permission registered successfully',
      data: {
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        displayName: permission.displayName,
        description: permission.description,
        module: permission.module,
        createdAt: permissionDoc.createdAt,
      },
    };
  }

  @Post('batch')
  @RequirePermissions('permission:create')
  @ApiOperation({ summary: '批量注册权限', description: '需要权限: permission:create。已存在的权限会被跳过' })
  @ApiResponse({ status: 201, description: '权限批量注册成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async registerPermissions(@Body() permissions: RegisterPermissionDto[]) {
    await this.permissionService.registerPermissions(permissions);
    return {
      code: 0,
      message: 'Permissions registered successfully',
      data: {
        count: permissions.length,
      },
    };
  }

  @Get()
  @RequirePermissions('permission:read')
  @ApiOperation({ summary: '查询所有权限', description: '需要权限: permission:read。可按模块过滤' })
  @ApiQuery({ name: 'module', required: false, description: '按模块过滤', example: 'user-management' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async listPermissions(@Query('module') module?: string) {
    const permissions = module
      ? await this.permissionService.listPermissionsByModule(module)
      : await this.permissionService.listPermissions();

    return {
      code: 0,
      message: 'Permissions retrieved successfully',
      data: permissions.map(permission => {
        const permissionDoc = permission as any;
        return {
          code: permission.code,
          resource: permission.resource,
          action: permission.action,
          displayName: permission.displayName,
          description: permission.description,
          module: permission.module,
          createdAt: permissionDoc.createdAt,
        };
      }),
    };
  }

  @Get('modules')
  @RequirePermissions('permission:read')
  @ApiOperation({ summary: '查询所有权限模块', description: '需要权限: permission:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async listModules() {
    const permissions = await this.permissionService.listPermissions();
    const modules = [...new Set(permissions.map(p => p.module))];
    
    return {
      code: 0,
      message: 'Modules retrieved successfully',
      data: modules.sort(),
    };
  }

  @Get(':code')
  @RequirePermissions('permission:read')
  @ApiOperation({ summary: '获取权限详情', description: '需要权限: permission:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '权限不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async getPermissionByCode(@Param('code') code: string) {
    const permission = await this.permissionService.getPermissionByCode(code);
    
    if (!permission) {
      return {
        code: 404,
        message: 'Permission not found',
      };
    }

    const permissionDoc = permission as any;
    return {
      code: 0,
      message: 'Permission retrieved successfully',
      data: {
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        displayName: permission.displayName,
        description: permission.description,
        module: permission.module,
        createdAt: permissionDoc.createdAt,
      },
    };
  }
}
