/*
 * Portal Auth Service
 * 开发者门户认证服务
 */
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PortalUser, PortalUserDocument } from '../database/schemas/portal-user.schema';
import {
  PortalRefreshToken,
  PortalRefreshTokenDocument,
} from '../database/schemas/portal-refresh-token.schema';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);
  private readonly jwtSecret: string;
  private readonly accessTokenExpires: string;
  private readonly refreshTokenExpiresDays: number;

  constructor(
    @InjectModel(PortalUser.name)
    private readonly userModel: Model<PortalUserDocument>,
    @InjectModel(PortalRefreshToken.name)
    private readonly refreshTokenModel: Model<PortalRefreshTokenDocument>,
  ) {
    this.accessTokenExpires =
      process.env.PORTAL_ACCESS_TOKEN_EXPIRES?.trim() || '15m';
    const accessTokenSeconds = this.parseExpiry(this.accessTokenExpires);
    if (accessTokenSeconds < 60 || accessTokenSeconds > 86400) {
      throw new Error(
        'PORTAL_ACCESS_TOKEN_EXPIRES must be between 60 seconds and 1 day',
      );
    }
    const configuredRefreshDays = Number(
      process.env.PORTAL_REFRESH_TOKEN_EXPIRES_DAYS ?? 7,
    );
    if (
      !Number.isInteger(configuredRefreshDays) ||
      configuredRefreshDays < 1 ||
      configuredRefreshDays > 365
    ) {
      throw new Error(
        'PORTAL_REFRESH_TOKEN_EXPIRES_DAYS must be an integer from 1 to 365',
      );
    }
    this.refreshTokenExpiresDays = configuredRefreshDays;
    const configuredSecret = process.env.PORTAL_JWT_SECRET?.trim();
    if (!configuredSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('PORTAL_JWT_SECRET is required in production');
      }
      this.jwtSecret = randomBytes(32).toString('hex');
      this.logger.warn('PORTAL_JWT_SECRET is not configured; using an ephemeral development secret');
    } else {
      if (Buffer.byteLength(configuredSecret, 'utf8') < 32) {
        throw new Error('PORTAL_JWT_SECRET must be at least 32 bytes');
      }
      this.jwtSecret = configuredSecret;
    }
  }

  /**
   * 用户注册
   */
  async register(
    email: string,
    username: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    // 检查邮箱是否已存在
    const existingUser = await this.userModel.findOne({
      email: email.toLowerCase(),
      deletedAt: null,
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // 检查用户名是否已存在
    const existingUsername = await this.userModel.findOne({
      username,
      deletedAt: null,
    });
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let user: PortalUserDocument;
    try {
      user = await this.userModel.create({
        email: email.toLowerCase(),
        username,
        passwordHash,
        role: 'user',
        status: 'active',
      });
    } catch (error: unknown) {
      if (Reflect.get(Object(error), 'code') === 11000) {
        throw new ConflictException('Email or username already registered');
      }
      throw error;
    }

    // 生成 tokens
    const accessToken = this.signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      username: user.username,
      role: user.role,
    });
    let refreshToken: string;
    try {
      refreshToken = (
        await this.createRefreshToken(user._id.toString())
      ).token;
    } catch (error) {
      await this.userModel.deleteOne({ _id: user._id });
      throw error;
    }

    this.logger.log(`User registered: ${email}`);

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * 用户登录
   */
  async login(
    email: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    // 查找用户
    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
      deletedAt: null,
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 检查用户状态
    if (user.status === 'suspended') {
      throw new UnauthorizedException('Account suspended');
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 更新登录信息
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    await user.save();

    // 生成 tokens
    const accessToken = this.signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      username: user.username,
      role: user.role,
    });
    const refreshToken = (
      await this.createRefreshToken(user._id.toString(), userAgent, ip)
    ).token;

    this.logger.log(`User logged in: ${email}`);

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * 用户登出
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenId = refreshToken.split('.')[0];
      await this.refreshTokenModel.updateOne(
        { tokenId, userId, isValid: true },
        { isValid: false, revokedAt: new Date() },
      );
    } else {
      await this.refreshTokenModel.updateMany(
        { userId, isValid: true },
        { isValid: false, revokedAt: new Date() },
      );
    }
    this.logger.log(`User logged out: ${userId}`);
  }

  /**
   * 刷新 Token
   */
  async refreshToken(
    token: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [tokenId, secret, ...extra] = token.split('.');
    if (!tokenId || !secret || extra.length > 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const refreshTokenDoc = await this.refreshTokenModel
      .findOne({ tokenId })
      .select('+secretHash');
    if (!refreshTokenDoc) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const presentedHash = createHash('sha256').update(secret).digest();
    const storedHash = Buffer.from(refreshTokenDoc.secretHash, 'hex');
    if (
      storedHash.length !== presentedHash.length ||
      !timingSafeEqual(storedHash, presentedHash)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!refreshTokenDoc.isValid) {
      await this.refreshTokenModel.updateMany(
        { familyId: refreshTokenDoc.familyId, isValid: true },
        { isValid: false, revokedAt: new Date() },
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (refreshTokenDoc.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.userModel.findById(refreshTokenDoc.userId);
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new UnauthorizedException('User not found or inactive');
    }

    refreshTokenDoc.isValid = false;
    refreshTokenDoc.revokedAt = new Date();

    const replacement = await this.createRefreshToken(
      user._id.toString(),
      refreshTokenDoc.userAgent,
      refreshTokenDoc.ip,
      refreshTokenDoc.familyId,
    );
    refreshTokenDoc.replacedByTokenId = replacement.tokenId;
    await refreshTokenDoc.save();

    const accessToken = this.signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      username: user.username,
      role: user.role,
    });

    return {
      accessToken,
      refreshToken: replacement.token,
    };
  }

  /**
   * 获取用户信息
   */
  async getUserById(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }
    return this.sanitizeUser(user);
  }

  /**
   * 更新用户信息
   */
  async updateUser(
    userId: string,
    data: { username?: string; avatar?: string },
  ): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    if (data.username) {
      // 检查用户名是否已存在
      const existing = await this.userModel.findOne({
        username: data.username,
        _id: { $ne: userId },
        deletedAt: null,
      });
      if (existing) {
        throw new ConflictException('Username already taken');
      }
      user.username = data.username;
    }

    if (data.avatar !== undefined) {
      user.avatar = data.avatar;
    }

    await user.save();
    return this.sanitizeUser(user);
  }

  /**
   * 修改密码
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    // 验证旧密码
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Invalid old password');
    }

    // 加密新密码
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save();

    // 使所有 refresh token 失效（强制重新登录）
    await this.refreshTokenModel.updateMany({ userId }, { isValid: false });

    this.logger.log(`Password changed for user: ${userId}`);
  }

  /**
   * 验证 Access Token
   */
  verifyAccessToken(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid format');

      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      );
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        throw new Error('Invalid header');
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      );
      const expectedSig = Buffer.from(
        this.computeSignature(parts[0] + '.' + parts[1]),
        'base64url',
      );
      const presentedSig = Buffer.from(parts[2], 'base64url');

      if (
        expectedSig.length !== presentedSig.length ||
        !timingSafeEqual(expectedSig, presentedSig)
      ) {
        throw new Error('Invalid signature');
      }
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        payload.exp < Date.now() / 1000
      ) {
        throw new Error('Invalid or expired payload');
      }

      return {
        sub: payload.sub,
        email: payload.email,
        username: payload.username,
        role: payload.role,
      };
    } catch (err: any) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 签发 Access Token
   */
  private signAccessToken(payload: Record<string, any>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');

    const expiresInSec = this.parseExpiry(this.accessTokenExpires);
    const body = Buffer.from(
      JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiresInSec,
      }),
    ).toString('base64url');

    const signature = this.computeSignature(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  /**
   * 创建 Refresh Token
   */
  private async createRefreshToken(
    userId: string,
    userAgent?: string,
    ip?: string,
    familyId = randomBytes(16).toString('hex'),
  ): Promise<{ token: string; tokenId: string }> {
    const tokenId = randomBytes(16).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const secretHash = createHash('sha256').update(secret).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenExpiresDays);

    await this.refreshTokenModel.create({
      userId,
      tokenId,
      secretHash,
      familyId,
      expiresAt,
      userAgent,
      ip,
      isValid: true,
    });

    return { token: `${tokenId}.${secret}`, tokenId };
  }

  /**
   * 计算签名
   */
  private computeSignature(input: string): string {
    return createHmac('sha256', this.jwtSecret)
      .update(input)
      .digest('base64url');
  }

  /**
   * 解析过期时间
   */
  private parseExpiry(exp: string): number {
    const m = exp.match(/^(\d+)([smhd])$/);
    if (!m) throw new Error(`Invalid access token expiry: ${exp}`);
    const mul: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(m[1], 10) * (mul[m[2]] || 60);
  }

  /**
   * 清理用户数据（移除敏感信息）
   */
  private sanitizeUser(user: PortalUserDocument): any {
    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      usage: user.usage,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
