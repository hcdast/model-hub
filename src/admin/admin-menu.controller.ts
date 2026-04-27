import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { MenuRegistryService } from './services/menu-registry.service';
import { PermissionCheckService } from './permission-check.service';

@ApiTags('管理后台 - 菜单')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/menu')
@UseGuards(AdminJwtGuard)
export class AdminMenuController {
  constructor(
    private readonly menuRegistryService: MenuRegistryService,
    private readonly permissionCheckService: PermissionCheckService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '获取菜单树',
    description: '返回当前用户权限过滤后的菜单树',
  })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getMenuTree(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id;
    const permissions =
      await this.permissionCheckService.getUserPermissions(userId);
    const tree = this.menuRegistryService.getFilteredMenuTree(permissions);
    return { code: 0, data: tree };
  }
}
