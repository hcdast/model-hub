/*
 * Admin Portal User Controller
 * 管理后台 - Portal 用户管理
 */
import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { PortalUser, PortalUserDocument } from '../database/schemas/portal-user.schema';
import { PortalApiKey, PortalApiKeyDocument } from '../database/schemas/portal-api-key.schema';

// ==================== DTOs ====================

class PortalUserQueryDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({ description: '每页数量', required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number;

  @ApiProperty({ description: '搜索关键词（邮箱/用户名）', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ description: '状态筛选', required: false, enum: ['active', 'suspended', 'pending'] })
  @IsOptional()
  @IsEnum(['active', 'suspended', 'pending'])
  status?: string;

  @ApiProperty({ description: '角色筛选', required: false, enum: ['user', 'admin', 'vip'] })
  @IsOptional()
  @IsEnum(['user', 'admin', 'vip'])
  role?: string;
}

class UpdatePortalUserDto {
  @ApiProperty({ description: '用户名', required: false })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({ description: '角色', required: false, enum: ['user', 'admin', 'vip'] })
  @IsOptional()
  @IsEnum(['user', 'admin', 'vip'])
  role?: string;

  @ApiProperty({ description: '状态', required: false, enum: ['active', 'suspended', 'pending'] })
  @IsOptional()
  @IsEnum(['active', 'suspended', 'pending'])
  status?: string;
}

// ==================== Controller ====================

@ApiTags('管理后台 - Portal 用户管理')
@Controller('api/v1/admin/portal-users')
@UseGuards(AdminJwtGuard, PermissionGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminPortalUserController {
  constructor(
    @InjectModel(PortalUser.name)
    private readonly portalUserModel: Model<PortalUserDocument>,
    @InjectModel(PortalApiKey.name)
    private readonly portalApiKeyModel: Model<PortalApiKeyDocument>,
  ) {}

  /**
   * 获取 Portal 用户列表
   */
  @Get()
  @RequirePermissions('portal-user:read')
  @ApiOperation({ summary: '获取用户列表', description: '分页查询 Portal 用户列表' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(@Query() query: PortalUserQueryDto) {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      status,
      role,
    } = query;

    // 构建查询条件
    const filter: any = { deletedAt: null };

    if (keyword) {
      filter.$or = [
        { email: { $regex: keyword, $options: 'i' } },
        { username: { $regex: keyword, $options: 'i' } },
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (role) {
      filter.role = role;
    }

    // 执行查询
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.portalUserModel
        .find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      this.portalUserModel.countDocuments(filter),
    ]);

    return {
      code: 0,
      message: 'Success',
      data: {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 获取用户详情
   */
  @Get(':id')
  @RequirePermissions('portal-user:read')
  @ApiOperation({ summary: '获取用户详情', description: '获取指定用户的详细信息及 API Key 列表' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  async getDetail(@Param('id') id: string): Promise<any> {
    const user = await this.portalUserModel
      .findById(id)
      .select('-passwordHash')
      .lean();

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    // 获取用户的 API Key 列表
    const apiKeys = await this.portalApiKeyModel
      .find({ userId: id })
      .sort({ createdAt: -1 })
      .lean();

    return {
      code: 0,
      message: 'Success',
      data: {
        ...user,
        apiKeys: apiKeys.map(key => ({
          id: key._id.toString(),
          apiKey: key.maskedKey,
          name: key.name,
          enabled: key.enabled,
          lastUsedAt: key.lastUsedAt,
          createdAt: key.createdAt,
        })),
      },
    };
  }

  /**
   * 更新用户信息
   */
  @Put(':id')
  @RequirePermissions('portal-user:update')
  @ApiOperation({ summary: '更新用户', description: '更新用户的角色、状态等信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePortalUserDto,
  ) {
    const user = await this.portalUserModel.findById(id);

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    // 更新字段
    if (dto.username !== undefined) user.username = dto.username;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.status !== undefined) user.status = dto.status;

    await user.save();

    return {
      code: 0,
      message: 'User updated',
      data: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
      },
    };
  }

  /**
   * 删除用户（软删除）
   */
  @Delete(':id')
  @RequirePermissions('portal-user:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除用户', description: '软删除用户' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '用户不存在' })
  async delete(@Param('id') id: string) {
    const user = await this.portalUserModel.findById(id);

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    user.deletedAt = new Date();
    user.status = 'suspended';
    await user.save();

    // 禁用用户的所有 API Key
    await this.portalApiKeyModel.updateMany(
      { userId: id },
      { enabled: false },
    );

    return {
      code: 0,
      message: 'User deleted',
    };
  }

  /**
   * 获取用户统计
   */
  @Get('stats/overview')
  @RequirePermissions('portal-user:read')
  @ApiOperation({ summary: '获取用户统计', description: '获取 Portal 用户统计数据' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getStats() {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
    ] = await Promise.all([
      this.portalUserModel.countDocuments({ deletedAt: null }),
      this.portalUserModel.countDocuments({ deletedAt: null, status: 'active' }),
      this.portalUserModel.countDocuments({ deletedAt: null, status: 'suspended' }),
      this.portalUserModel.countDocuments({
        deletedAt: null,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
      this.portalUserModel.countDocuments({
        deletedAt: null,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
      this.portalUserModel.countDocuments({
        deletedAt: null,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    // 按角色统计
    const roleStats = await this.portalUserModel.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    return {
      code: 0,
      message: 'Success',
      data: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        newUsersToday,
        newUsersThisWeek,
        newUsersThisMonth,
        roleStats: roleStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
    };
  }

  /**
   * 禁用/启用用户
   */
  @Put(':id/toggle-status')
  @RequirePermissions('portal-user:update')
  @ApiOperation({ summary: '切换用户状态', description: '禁用或启用用户' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async toggleStatus(@Param('id') id: string) {
    const user = await this.portalUserModel.findById(id);

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    user.status = user.status === 'active' ? 'suspended' : 'active';
    await user.save();

    return {
      code: 0,
      message: `User ${user.status === 'active' ? 'enabled' : 'disabled'}`,
      data: {
        id: user._id.toString(),
        status: user.status,
      },
    };
  }
}
