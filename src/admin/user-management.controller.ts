import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserManagementService, UserFilters, Pagination } from './user-management.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 用户管理')
@Controller('api/v1/admin/users')
@UseGuards(AdminJwtGuard, PermissionGuard)
@ApiBearerAuth()
export class UserManagementController {
  constructor(private readonly userManagementService: UserManagementService) {}

  @Post()
  @RequirePermissions('user:create')
  @ApiOperation({ summary: '创建用户', description: '需要权限: user:create' })
  @ApiResponse({ status: 201, description: '用户创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误（用户名已存在、角色无效、密码不符合复杂度要求）' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async createUser(@Body() createUserDto: CreateUserDto) {
    const user = await this.userManagementService.createUser(createUserDto);
    const userDoc = user as any; // Cast to access Mongoose document properties
    return {
      code: 0,
      message: 'User created successfully',
      data: {
        id: userDoc._id,
        username: user.username,
        roles: user.roles,
        email: user.email,
        displayName: user.displayName,
        enabled: user.enabled,
        createdAt: userDoc.createdAt,
      },
    };
  }

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '查询用户列表', description: '需要权限: user:read。支持按用户名、状态、角色过滤，分页返回' })
  @ApiQuery({ name: 'username', required: false, description: '用户名模糊搜索' })
  @ApiQuery({ name: 'enabled', required: false, description: '启用状态过滤', enum: ['true', 'false'] })
  @ApiQuery({ name: 'roles', required: false, description: '角色过滤（逗号分隔）', example: 'admin,operator' })
  @ApiQuery({ name: 'includeDeleted', required: false, description: '是否包含已删除用户', enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false, description: '页码', example: '1' })
  @ApiQuery({ name: 'limit', required: false, description: '每页数量', example: '10' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async listUsers(
    @Query('username') username?: string,
    @Query('enabled') enabled?: string,
    @Query('roles') roles?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: UserFilters = {
      username,
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
      roles: roles ? roles.split(',') : undefined,
      includeDeleted: includeDeleted === 'true',
    };

    const pagination: Pagination = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    };

    const result = await this.userManagementService.listUsers(filters, pagination);
    
    return {
      code: 0,
      message: 'Users retrieved successfully',
      data: {
        users: result.data.map(user => {
          const userDoc = user as any;
          return {
            id: userDoc._id,
            username: user.username,
            roles: user.roles,
            email: user.email,
            displayName: user.displayName,
            enabled: user.enabled,
            lastLoginAt: user.lastLoginAt,
            createdAt: userDoc.createdAt,
            deletedAt: user.deletedAt,
          };
        }),
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      },
    };
  }

  @Get(':id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '获取用户详情', description: '需要权限: user:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async getUserById(@Param('id') id: string) {
    const user = await this.userManagementService.getUserById(id);
    const userDoc = user as any;
    return {
      code: 0,
      message: 'User retrieved successfully',
      data: {
        id: userDoc._id,
        username: user.username,
        roles: user.roles,
        email: user.email,
        displayName: user.displayName,
        enabled: user.enabled,
        requirePasswordChange: user.requirePasswordChange,
        lastLoginAt: user.lastLoginAt,
        createdAt: userDoc.createdAt,
        updatedAt: userDoc.updatedAt,
      },
    };
  }

  @Put(':id')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '更新用户信息', description: '需要权限: user:update' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 400, description: '请求参数错误（角色无效）' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user = await this.userManagementService.updateUser(id, updateUserDto);
    const userDoc = user as any;
    return {
      code: 0,
      message: 'User updated successfully',
      data: {
        id: userDoc._id,
        username: user.username,
        roles: user.roles,
        email: user.email,
        displayName: user.displayName,
        enabled: user.enabled,
        updatedAt: userDoc.updatedAt,
      },
    };
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除用户（软删除）', description: '需要权限: user:delete。用户记录不会被物理删除，仅标记 deletedAt' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async deleteUser(@Param('id') id: string) {
    await this.userManagementService.deleteUser(id);
    return {
      code: 0,
      message: 'User deleted successfully',
    };
  }

  @Put(':id/status')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '启用/禁用用户', description: '需要权限: user:update。禁用后用户无法登录和执行任何操作' })
  @ApiResponse({ status: 200, description: '状态更新成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async toggleUserStatus(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
  ) {
    await this.userManagementService.toggleUserStatus(id, enabled);
    return {
      code: 0,
      message: 'User status updated successfully',
    };
  }

  @Put(':id/roles')
  @RequirePermissions('user:update', 'role:read')
  @ApiOperation({ summary: '为用户分配角色', description: '需要权限: user:update AND role:read。用户必须至少保留一个角色' })
  @ApiResponse({ status: 200, description: '角色分配成功' })
  @ApiResponse({ status: 400, description: '角色无效或用户必须至少保留一个角色' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async assignRoles(
    @Param('id') id: string,
    @Body('roles') roles: string[],
  ) {
    await this.userManagementService.assignRoles(id, roles);
    return {
      code: 0,
      message: 'Roles assigned successfully',
    };
  }

  @Put(':id/password')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '修改密码（用户自己修改）', description: '需要权限: user:update。需验证旧密码，新密码须满足复杂度要求' })
  @ApiResponse({ status: 200, description: '密码修改成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 422, description: '旧密码错误或新密码不符合复杂度要求' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async changePassword(
    @Param('id') id: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.userManagementService.changePassword(id, changePasswordDto);
    return {
      code: 0,
      message: 'Password changed successfully',
    };
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '重置密码（管理员操作）', description: '需要权限: user:update。生成临时密码，用户首次登录时须修改' })
  @ApiResponse({ status: 200, description: '密码重置成功，返回临时密码' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  @ApiResponse({ status: 403, description: '权限不足' })
  async resetPassword(@Param('id') id: string) {
    const temporaryPassword = await this.userManagementService.resetPassword(id);
    return {
      code: 0,
      message: 'Password reset successfully',
      data: {
        temporaryPassword,
        note: 'User will be required to change password on next login',
      },
    };
  }
}
