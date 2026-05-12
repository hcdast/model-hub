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
import { MenuManagementService } from './menu-management.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 菜单管理')
@Controller('api/v1/admin/menus')
@UseGuards(AdminJwtGuard, PermissionGuard)
@ApiBearerAuth()
export class MenuManagementController {
  constructor(private readonly menuManagementService: MenuManagementService) {}

  @Get()
  @RequirePermissions('menu:read')
  @ApiOperation({ summary: '获取菜单树', description: '需要权限: menu:read。返回完整的菜单树结构' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTree() {
    const tree = await this.menuManagementService.getTree();
    return { code: 0, data: tree };
  }

  @Get('flat')
  @RequirePermissions('menu:read')
  @ApiOperation({ summary: '获取扁平菜单列表', description: '需要权限: menu:read。返回所有菜单项的扁平列表' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listAll() {
    const list = await this.menuManagementService.listAll();
    return { code: 0, data: list };
  }

  @Get(':key')
  @RequirePermissions('menu:read')
  @ApiOperation({ summary: '获取菜单详情', description: '需要权限: menu:read' })
  @ApiResponse({ status: 200, description: '查询成功' })
  @ApiResponse({ status: 404, description: '菜单不存在' })
  async getByKey(@Param('key') key: string) {
    const menu = await this.menuManagementService.getByKey(key);
    return { code: 0, data: menu };
  }

  @Post()
  @RequirePermissions('menu:create')
  @ApiOperation({ summary: '创建菜单', description: '需要权限: menu:create' })
  @ApiResponse({ status: 201, description: '菜单创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  async create(@Body() dto: CreateMenuDto) {
    const menu = await this.menuManagementService.create(dto);
    return { code: 0, message: 'Menu created successfully', data: menu };
  }

  @Put(':key')
  @RequirePermissions('menu:update')
  @ApiOperation({ summary: '更新菜单', description: '需要权限: menu:update' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '菜单不存在' })
  async update(@Param('key') key: string, @Body() dto: UpdateMenuDto) {
    const menu = await this.menuManagementService.update(key, dto);
    return { code: 0, message: 'Menu updated successfully', data: menu };
  }

  @Delete(':key')
  @RequirePermissions('menu:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除菜单', description: '需要权限: menu:delete。有子菜单的菜单无法直接删除' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '菜单不存在' })
  @ApiResponse({ status: 400, description: '存在子菜单，无法删除' })
  async delete(@Param('key') key: string) {
    await this.menuManagementService.delete(key);
    return { code: 0, message: 'Menu deleted successfully' };
  }
}
