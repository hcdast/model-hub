import { Injectable, Logger, Inject, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionCheckService } from './permission-check.service';

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    @InjectModel(AdminUser.name) private readonly userModel: Model<AdminUserDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly permissionCacheService: PermissionCacheService,
    private readonly permissionCheckService: PermissionCheckService,
  ) {
    this.jwtSecret = config.admin.jwtSecret;
    this.jwtExpiresIn = config.admin.jwtExpiresIn;
  }

  async onModuleInit(): Promise<void> {
    const count = await this.userModel.countDocuments();
    if (count === 0) {
      const hash = await bcrypt.hash(this.config.admin.defaultPassword, 10);
      await this.userModel.create({ username: this.config.admin.defaultUsername, passwordHash: hash, roles: ['super_admin'], enabled: true });
      this.logger.log(`Default admin user created: ${this.config.admin.defaultUsername}`);
    }
  }

  async login(username: string, password: string) {
    const user = await this.userModel.findOne({ username, enabled: true, deletedAt: null });
    if (!user) {
      ErrorLogger.logWarning(
        this.logger,
        'Login failed: user not found or disabled',
        { username },
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      ErrorLogger.logWarning(
        this.logger,
        'Login failed: invalid password',
        { username },
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    user.lastLoginAt = new Date();
    await user.save();

    // 支持多角色：将所有角色包含在 token 中
    const accessToken = this.signToken({
      sub: user._id.toString(),
      username: user.username,
      roles: user.roles,
    });

    this.logger.log(`Admin user logged in: ${username}`);

    // Resolve user permissions and menus from roles
    const permissions = await this.permissionCheckService.getUserPermissions(user._id.toString());
    const menus = await this.permissionCheckService.getUserMenus(user._id.toString());

    return {
      accessToken,
      expiresIn: this.jwtExpiresIn,
      requirePasswordChange: user.requirePasswordChange || false,
      roles: user.roles,
      permissions,
      menus,
    };
  }

  /**
   * 登出：清除用户的权限缓存
   */
  async logout(userId: string): Promise<void> {
    await this.permissionCacheService.clearUserPermissions(userId);
    this.logger.log(`Admin user logged out, cache cleared for userId: ${userId}`);
  }

  verifyToken(token: string) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid format');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const expectedSig = this.computeSignature(parts[0] + '.' + parts[1]);
      if (parts[2] !== expectedSig) throw new Error('Invalid signature');
      if (payload.exp && payload.exp < Date.now() / 1000) throw new Error('Token expired');
      return { sub: payload.sub, username: payload.username, roles: payload.roles };
    } catch (err: any) {
      ErrorLogger.logWarning(
        this.logger,
        'Token verification failed',
        { error: err.message },
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private signToken(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const expiresInSec = this.parseExpiry(this.jwtExpiresIn);
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec })).toString('base64url');
    return `${header}.${body}.${this.computeSignature(`${header}.${body}`)}`;
  }

  private computeSignature(input: string): string { return createHmac('sha256', this.jwtSecret).update(input).digest('base64url'); }

  private parseExpiry(exp: string): number {
    const m = exp.match(/^(\d+)([smhd])$/);
    if (!m) return 7200;
    const mul: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(m[1], 10) * (mul[m[2]] || 3600);
  }
}
