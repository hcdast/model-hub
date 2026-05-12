import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RoleManagementService } from './role-management.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 角色管理')
@Controller('api/v1/admin/roles')
@UseGuards(AdminJwtGuard, PermissionGuard)
@ApiBearerAuth()
export class RoleManagementController {
  constructor(private readonly roleManagementService: RoleManagementService) {}

  @Post()
  @RequirePermissions('role:create')
  @ApiOperation({ summary: '创建角色', description: '需要权限: role:create' })
  @ApiResponse({ status: 201, description: '角色创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误（角色名已存在、权限无效）' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async createRole(@Body() createRoleDto: CreateRoleDto) {
    const role = await this.roleManagementService.createRole(createRoleDto);
    const roleDoc = role as any;
    return {
      code: 0,
      message: 'Role created successfully',
      data: {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        menus: role.menus || [],
        isSystem: role.isSystem,
        enabled: role.enabled,
        createdAt: roleDoc.createdAt,
      },
    };
  }

  @Get()
  @RequirePermissions('role:read')
  @ApiOperation({ summary: '查询角色列表', description: '需要权限: role:read。返回所有角色及其关联的权限和菜单列表' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async listRoles() {
    const roles = await this.roleManagementService.listRoles();
    return {
      code: 0,
      message: 'Roles retrieved successfully',
      data: roles.map(role => {
        const roleDoc = role as any;
        return {
          name: role.name,
          displayName: role.displayName,
          description: role.description,
          permissions: role.permissions,
          menus: role.menus || [],
          isSystem: role.isSystem,
          enabled: role.enabled,
          createdAt: roleDoc.createdAt,
          updatedAt: roleDoc.updatedAt,
        };
      }),
    };
  }

  @Get(':name')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: '获取角色详情', description: '需要权限: role:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '角色不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async getRoleByName(@Param('name') name: string) {
    const role = await this.roleManagementService.getRoleByName(name);
    const roleDoc = role as any;
    return {
      code: 0,
      message: 'Role retrieved successfully',
      data: {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        menus: role.menus || [],
        isSystem: role.isSystem,
        enabled: role.enabled,
        createdAt: roleDoc.createdAt,
        updatedAt: roleDoc.updatedAt,
      },
    };
  }

  @Put(':name')
  @RequirePermissions('role:update')
  @ApiOperation({ summary: '更新角色信息', description: '需要权限: role:update。更新权限或菜单后会自动清除相关用户的缓存' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '权限无效' })
  @ApiResponse({ status: 404, description: '角色不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async updateRole(
    @Param('name') name: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    const role = await this.roleManagementService.updateRole(name, updateRoleDto);
    const roleDoc = role as any;
    return {
      code: 0,
      message: 'Role updated successfully',
      data: {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        menus: role.menus || [],
        enabled: role.enabled,
        updatedAt: roleDoc.updatedAt,
      },
    };
  }

  @Delete(':name')
  @RequirePermissions('role:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除角色', description: '需要权限: role:delete。已分配给用户的角色无法删除' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '角色不存在' })
  @ApiResponse({ status: 409, description: '角色正在使用中，无法删除' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async deleteRole(@Param('name') name: string) {
    await this.roleManagementService.deleteRole(name);
    return {
      code: 0,
      message: 'Role deleted successfully',
    };
  }

  @Put(':name/permissions')
  @RequirePermissions('role:update', 'permission:read')
  @ApiOperation({ summary: '为角色分配权限', description: '需要权限: role:update AND permission:read。更新后自动清除相关用户的权限缓存' })
  @ApiResponse({ status: 200, description: '权限分配成功' })
  @ApiResponse({ status: 400, description: '权限无效' })
  @ApiResponse({ status: 404, description: '角色不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async assignPermissions(
    @Param('name') name: string,
    @Body('permissions') permissions: string[],
  ) {
    await this.roleManagementService.assignPermissions(name, permissions);
    return {
      code: 0,
      message: 'Permissions assigned successfully',
    };
  }

  @Put(':name/menus')
  @RequirePermissions('role:update', 'menu:read')
  @ApiOperation({ summary: '为角色分配菜单', description: '需要权限: role:update AND menu:read。更新后自动清除相关用户的缓存' })
  @ApiResponse({ status: 200, description: '菜单分配成功' })
  @ApiResponse({ status: 404, description: '角色不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async assignMenus(
    @Param('name') name: string,
    @Body('menus') menus: string[],
  ) {
    await this.roleManagementService.assignMenus(name, menus);
    return {
      code: 0,
      message: 'Menus assigned successfully',
    };
  }

  @Get(':name/in-use')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: '检查角色是否被使用', description: '需要权限: role:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async checkRoleInUse(@Param('name') name: string) {
    const inUse = await this.roleManagementService.isRoleInUse(name);
    return {
      code: 0,
      message: 'Role usage status retrieved successfully',
      data: {
        roleName: name,
        inUse,
      },
    };
  }
}
