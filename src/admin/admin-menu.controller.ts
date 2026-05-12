import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import {
  MenuRegistryService,
  MenuGroup,
} from './services/menu-registry.service';
import { PermissionCheckService } from './permission-check.service';

/**
 * 菜单管理控制器
 * 提供菜单树查询接口，根据当前用户权限返回过滤后的菜单结构
 */
@ApiTags('管理后台 - 菜单')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/menu')
@UseGuards(AdminJwtGuard)
export class AdminMenuController {
  constructor(
    private readonly menuRegistryService: MenuRegistryService,
    private readonly permissionCheckService: PermissionCheckService,
  ) {}

  /**
   * 获取当前用户的菜单树
   * 根据用户权限过滤菜单项，无权限的菜单项和空的父级分组会被移除
   */
  @Get()
  @ApiOperation({
    summary: '获取菜单树',
    description: '返回当前用户授权的菜单树（基于角色的 menus 字段过滤）',
  })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getMenuTree(
    @Req() req: any,
  ): Promise<{ code: number; data: MenuGroup[] }> {
    // 从 JWT 守卫注入的用户信息中获取用户 ID
    const userId = req.user?.userId || req.user?.id;

    // 通过权限检查服务获取用户的授权菜单 key
    const userMenus =
      await this.permissionCheckService.getUserMenus(userId);

    // 如果用户没有分配任何菜单，回退到权限过滤（兼容旧数据）
    if (userMenus.length === 0) {
      const permissions =
        await this.permissionCheckService.getUserPermissions(userId);
      const tree = this.menuRegistryService.getFilteredMenuTree(permissions);
      return { code: 0, data: tree };
    }

    // 根据用户授权菜单 key 过滤菜单树
    const tree = this.menuRegistryService.getFilteredMenuTreeByKeys(userMenus);
    return { code: 0, data: tree };
  }
}
