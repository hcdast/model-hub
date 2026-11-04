/*
 * Portal Auth Service
 * 开发者门户认证服务
 */
import {
  Injectable,
  Inject,
  OnModuleInit,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
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
import { generateTemporaryPassword } from '../admin/utils/password.util';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class PortalAuthService implements OnModuleInit {
  private readonly logger = new Logger(PortalAuthService.name);
  private readonly jwtSecret: string;
  private readonly accessTokenExpires: string;
  private readonly refreshTokenExpiresDays: number;

  constructor(
    @InjectModel(PortalUser.name)
    private readonly userModel: Model<PortalUserDocument>,
    @InjectModel(PortalRefreshToken.name)
    private readonly refreshTokenModel: Model<PortalRefreshTokenDocument>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.accessTokenExpires =
      config.portalAuth?.accessTokenExpires?.trim() || '15m';
    const accessTokenSeconds = this.parseExpiry(this.accessTokenExpires);
    if (accessTokenSeconds < 60 || accessTokenSeconds > 86400) {
      throw new Error(
        'portalAuth.accessTokenExpires must be between 60 seconds and 1 day',
      );
    }
    const configuredRefreshDays = Number(
      config.portalAuth?.refreshTokenExpiresDays ?? 7,
    );
    if (
      !Number.isInteger(configuredRefreshDays) ||
      configuredRefreshDays < 1 ||
      configuredRefreshDays > 365
    ) {
      throw new Error(
        'portalAuth.refreshTokenExpiresDays must be an integer from 1 to 365',
      );
    }
    this.refreshTokenExpiresDays = configuredRefreshDays;
    const configuredSecret = config.portalAuth?.jwtSecret?.trim();
    if (!configuredSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('portalAuth.jwtSecret is required in production');
      }
      this.jwtSecret = randomBytes(32).toString('hex');
      this.logger.warn('portalAuth.jwtSecret is not configured; using an ephemeral development secret');
    } else {
      if (Buffer.byteLength(configuredSecret, 'utf8') < 32) {
        throw new Error('portalAuth.jwtSecret must be at least 32 bytes');
      }
      this.jwtSecret = configuredSecret;
    }
  }

  getRefreshCookieMaxAge(): number {
    return this.refreshTokenExpiresDays * 24 * 60 * 60 * 1000;
  }

  async onModuleInit(): Promise<void> {
    let indexes: Awaited<ReturnType<typeof this.refreshTokenModel.collection.indexes>>;
    try {
      indexes = await this.refreshTokenModel.collection.indexes();
    } catch (error) {
      if (this.isMissingMongoResource(error, false)) return;
      throw error;
    }
    const legacyTokenIndex = indexes.find((index) => {
      const keys = Object.entries(index.key);
      return index.unique === true && keys.length === 1 && keys[0][0] === 'token';
    });
    if (legacyTokenIndex?.name) {
      try {
        await this.refreshTokenModel.collection.dropIndex(legacyTokenIndex.name);
      } catch (error) {
        if (!this.isMissingMongoResource(error, true)) throw error;
      }
    }
  }

  private isMissingMongoResource(error: unknown, includeIndex: boolean): boolean {
    const code = Reflect.get(Object(error), 'code');
    const codeName = Reflect.get(Object(error), 'codeName');
    if (code !== undefined) return code === 26 || (includeIndex && code === 27);
    return codeName === 'NamespaceNotFound' || (includeIndex && codeName === 'IndexNotFound');
  }

  /**
   * 用户注册
   */
  async register(
    email: string,
    username: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    email = email.trim().toLowerCase();
    username = username.trim();
    this.assertPassword(password);
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
        authVersion: 0,
        role: 'user',
        status: 'active',
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
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
    const authVersion = this.getAuthVersion(user.authVersion, true);
    try {
      refreshToken = (
        await this.createRefreshToken(user._id.toString(), authVersion)
      ).token;
    } catch (error) {
      await this.userModel.deleteOne({ _id: user._id });
      throw error;
    }
    await this.confirmIssuedToken(user._id.toString(), authVersion, refreshToken.split('.')[0]);

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
      email: email.trim().toLowerCase(),
      deletedAt: null,
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // 检查用户状态
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    const authVersion = this.getAuthVersion(user.authVersion, true);
    // 验证密码
    const isValid = user.passwordHash && await bcrypt.compare(password, user.passwordHash);
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
      await this.createRefreshToken(user._id.toString(), authVersion, userAgent, ip)
    ).token;
    await this.confirmIssuedToken(user._id.toString(), authVersion, refreshToken.split('.')[0]);

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
    const authVersion = this.getAuthVersion(refreshTokenDoc.authVersion);
    if (authVersion !== this.getAuthVersion(user.authVersion, true)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    refreshTokenDoc.isValid = false;
    refreshTokenDoc.revokedAt = new Date();

    const replacement = await this.createRefreshToken(
      user._id.toString(),
      authVersion,
      refreshTokenDoc.userAgent,
      refreshTokenDoc.ip,
      refreshTokenDoc.familyId,
    );
    refreshTokenDoc.replacedByTokenId = replacement.tokenId;
    await refreshTokenDoc.save();
    await this.confirmIssuedToken(user._id.toString(), authVersion, replacement.tokenId);

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
    const isValid = user.passwordHash && await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Invalid old password');
    }

    this.assertPassword(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updated = await this.updatePassword(user, passwordHash, true);
    await this.revokeOlderTokens(updated._id.toString(), this.getAuthVersion(updated.authVersion));

    this.logger.log(`Password changed for user: ${userId}`);
  }

  /** 管理员重置密码；现有 access token 保持原有到期语义。 */
  async resetPassword(userId: string): Promise<string> {
    if (!/^[a-f\d]{24}$/i.test(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userModel.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const updated = await this.updatePassword(user, passwordHash, false);
    await this.revokeOlderTokens(updated._id.toString(), this.getAuthVersion(updated.authVersion));
    return temporaryPassword;
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

  /** Capture the authenticated account in server-side OAuth state, never in a query parameter. */
  async getOAuthLinkAccount(userId: string): Promise<{ userId: string; authVersion: number }> {
    const user = await this.userModel.findById(userId);
    if (!user || user.deletedAt || user.status !== 'active') throw new UnauthorizedException('Account is not active');
    return { userId: user._id.toString(), authVersion: this.getAuthVersion(user.authVersion, true) };
  }

  /** Requires both a local authenticated session and a fresh, browser-bound provider proof. */
  async linkOAuthAccount(
    provider: 'google' | 'github',
    profile: { id: string; email: string; username: string; avatar?: string },
    account: { userId: string; authVersion: number },
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const identityField = provider === 'google' ? 'googleId' : 'githubId';
    const user = await this.userModel.findById(account.userId);
    if (!user || user.deletedAt || user.status !== 'active' ||
      this.getAuthVersion(user.authVersion, true) !== account.authVersion) {
      throw new UnauthorizedException('Account authentication changed. Please sign in again');
    }
    if (user.email.trim().toLowerCase() !== profile.email.trim().toLowerCase()) {
      throw new ConflictException('Use the provider account with the same email as your Model Hub account');
    }
    if (user[identityField] && user[identityField] !== profile.id) {
      throw new ConflictException('A different provider account is already linked');
    }
    try {
      const linked = await this.userModel.findOneAndUpdate({
        _id: user._id, email: user.email, status: 'active', deletedAt: null,
        [identityField]: { $in: [null, profile.id] },
        $or: [
          { authVersion: account.authVersion },
          ...(account.authVersion === 0 ? [{ authVersion: { $exists: false } }] : []),
        ],
      }, { $set: { [identityField]: profile.id } }, { new: true });
      if (!linked) throw new ConflictException('Account changed. Please retry linking');
    } catch (error) {
      if (Reflect.get(Object(error), 'code') === 11000) {
        throw new ConflictException('This provider account is already linked to another account');
      }
      throw error;
    }
    return this.loginWithOAuth(provider, profile, ip, userAgent, account);
  }

  /** Only the provider subject identifies an OAuth account; email alone never links accounts. */
  async loginWithOAuth(
    provider: 'google' | 'github',
    profile: { id: string; email: string; username: string; avatar?: string },
    ip?: string,
    userAgent?: string,
    expectedAccount?: { userId: string; authVersion: number },
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const identityField = provider === 'google' ? 'googleId' : 'githubId';
    let user = await this.userModel.findOne({ [identityField]: profile.id });
    if (expectedAccount && (!user || user._id.toString() !== expectedAccount.userId)) {
      throw new UnauthorizedException('Linked account changed. Please sign in again');
    }
    if (!user) {
      if (await this.userModel.findOne({ email: profile.email })) {
        throw new ConflictException('An account already uses this email. Sign in using its original method.');
      }
      const name = profile.username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 19) || 'user';
      try {
        user = await this.userModel.create({
          [identityField]: profile.id,
          email: profile.email,
          username: `${name}_${randomBytes(5).toString('hex')}`,
          avatar: profile.avatar,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          authVersion: 0,
          role: 'user',
          status: 'active',
        });
      } catch (error) {
        if (Reflect.get(Object(error), 'code') !== 11000) throw error;
        user = await this.userModel.findOne({ [identityField]: profile.id });
        if (!user) throw new ConflictException('An account already uses this email. Sign in using its original method.');
      }
    }
    if (user.deletedAt || user.status !== 'active') throw new UnauthorizedException('Account is not active');
    const authVersion = this.getAuthVersion(user.authVersion, true);
    if (expectedAccount && authVersion !== expectedAccount.authVersion) {
      throw new UnauthorizedException('Account authentication changed. Please sign in again');
    }
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    await user.save();
    const refresh = await this.createRefreshToken(user._id.toString(), authVersion, userAgent, ip);
    await this.confirmIssuedToken(user._id.toString(), authVersion, refresh.tokenId);
    return {
      accessToken: this.signAccessToken({ sub: user._id.toString(), email: user.email, username: user.username, role: user.role }),
      refreshToken: refresh.token,
      user: this.sanitizeUser(user),
    };
  }

  async canResetPassword(email: string): Promise<boolean> {
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase(), deletedAt: null });
    return !!user && user.status === 'active' && !!user.passwordHash;
  }

  /** Called only after consuming a one-time email proof. OAuth-only accounts keep their original sign-in method. */
  async recoverPassword(email: string, password: string): Promise<void> {
    this.assertPassword(password);
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase(), deletedAt: null });
    if (!user || user.status !== 'active' || !user.passwordHash) throw new BadRequestException('Unable to reset password');
    const updated = await this.updatePassword(user, await bcrypt.hash(password, BCRYPT_ROUNDS), true);
    await this.revokeOlderTokens(updated._id.toString(), this.getAuthVersion(updated.authVersion));
  }

  // ==================== 私有方法 ====================

  private assertPassword(password: string): void {
    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('Password must be at least 8 characters and at most 72 UTF-8 bytes');
    }
  }

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
    authVersion: number,
    userAgent?: string,
    ip?: string,
    familyId = randomBytes(16).toString('hex'),
  ): Promise<{ token: string; tokenId: string }> {
    this.getAuthVersion(authVersion);
    const tokenId = randomBytes(16).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const secretHash = createHash('sha256').update(secret).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenExpiresDays);

    await this.refreshTokenModel.create({
      userId,
      authVersion,
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

  private getAuthVersion(value: unknown, allowMissing = false): number {
    if (value === undefined && allowMissing) return 0;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new UnauthorizedException('Invalid authentication state');
    }
    return value;
  }

  private async updatePassword(
    user: PortalUserDocument,
    passwordHash: string,
    checkPassword: boolean,
  ): Promise<PortalUserDocument> {
    this.getAuthVersion(user.authVersion, true);
    const updated = await this.userModel.findOneAndUpdate(
      {
        _id: user._id,
        deletedAt: null,
        ...(checkPassword ? { passwordHash: user.passwordHash } : {}),
        // Guard a concurrent increment at the safe-integer limit as well.
        $or: [
          { authVersion: { $exists: false } },
          { authVersion: { $type: 'number', $gte: 0, $lt: Number.MAX_SAFE_INTEGER, $mod: [1, 0] } },
        ],
      },
      { $set: { passwordHash }, $inc: { authVersion: 1 } },
      { new: true },
    );
    if (!updated) throw new ConflictException('Authentication state changed; retry with current credentials');
    return updated;
  }

  private async revokeOlderTokens(userId: string, authVersion: number): Promise<void> {
    try {
      await this.refreshTokenModel.updateMany(
        { userId, $or: [{ authVersion: { $exists: false } }, { authVersion: { $lt: authVersion } }] },
        { isValid: false, revokedAt: new Date() },
      );
    } catch {
      throw new ServiceUnavailableException('Unable to complete session revocation');
    }
  }

  private async confirmIssuedToken(userId: string, authVersion: number, tokenId: string): Promise<void> {
    try {
      const current = await this.userModel.findById(userId);
      if (!current || current.deletedAt || current.status !== 'active' ||
          this.getAuthVersion(current.authVersion, true) !== authVersion) {
        throw new UnauthorizedException('Authentication state changed');
      }
    } catch (error) {
      try {
        await this.refreshTokenModel.updateOne(
          { userId, tokenId },
          { isValid: false, revokedAt: new Date() },
        );
      } catch {
        // Version validation remains authoritative if best-effort cleanup fails.
      }
      throw error;
    }
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
      authMethods: { password: !!user.passwordHash, google: !!user.googleId, github: !!user.githubId },
    };
  }
}
