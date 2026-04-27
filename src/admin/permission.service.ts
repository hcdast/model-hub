import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permission, PermissionDocument } from '../database/schemas/permission.schema';
import { RegisterPermissionDto } from './dto/register-permission.dto';

@Injectable()
export class PermissionService {
  constructor(
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<PermissionDocument>,
  ) {}

  /**
   * 验证权限代码格式是否符合 "resource:action" 格式
   */
  validatePermissionCodeFormat(code: string): boolean {
    const regex = /^[a-z-]+:[a-z-]+$/;
    return regex.test(code);
  }

  /**
   * 注册单个权限
   */
  async registerPermission(data: RegisterPermissionDto): Promise<Permission> {
    // 验证权限代码格式
    if (!this.validatePermissionCodeFormat(data.code)) {
      throw new BadRequestException(
        'Permission code must follow the format "resource:action"',
      );
    }

    // 验证 code 是否与 resource:action 匹配
    const expectedCode = `${data.resource}:${data.action}`;
    if (data.code !== expectedCode) {
      throw new BadRequestException(
        `Permission code "${data.code}" does not match resource:action "${expectedCode}"`,
      );
    }

    // 检查权限是否已存在
    const existing = await this.permissionModel.findOne({ code: data.code });
    if (existing) {
      throw new BadRequestException(`Permission with code "${data.code}" already exists`);
    }

    const permission = new this.permissionModel(data);
    return permission.save();
  }

  /**
   * 批量注册权限
   */
  async registerPermissions(permissions: RegisterPermissionDto[]): Promise<void> {
    for (const permissionData of permissions) {
      try {
        await this.registerPermission(permissionData);
      } catch (error) {
        // 如果权限已存在，跳过
        if (error instanceof BadRequestException && error.message.includes('already exists')) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * 查询所有权限
   */
  async listPermissions(): Promise<Permission[]> {
    return this.permissionModel.find().sort({ module: 1, code: 1 }).exec();
  }

  /**
   * 按模块查询权限
   */
  async listPermissionsByModule(module: string): Promise<Permission[]> {
    return this.permissionModel.find({ module }).sort({ code: 1 }).exec();
  }

  /**
   * 根据权限代码获取权限
   */
  async getPermissionByCode(code: string): Promise<Permission | null> {
    return this.permissionModel.findOne({ code }).exec();
  }

  /**
   * 验证权限代码是否存在
   */
  async validatePermissionExists(code: string): Promise<boolean> {
    const permission = await this.getPermissionByCode(code);
    return permission !== null;
  }

  /**
   * 批量验证权限代码是否存在（单次查询优化）
   */
  async validatePermissionsExist(codes: string[]): Promise<boolean> {
    if (codes.length === 0) return true;
    const count = await this.permissionModel.countDocuments({ code: { $in: codes } });
    return count === codes.length;
  }

  /**
   * 获取不存在的权限代码列表（单次查询优化）
   */
  async getInvalidPermissions(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const existing = await this.permissionModel
      .find({ code: { $in: codes } })
      .select('code')
      .lean();
    const existingSet = new Set(existing.map(p => p.code));
    return codes.filter(code => !existingSet.has(code));
  }
}
