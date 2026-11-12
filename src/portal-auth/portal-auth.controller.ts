/*
 * Portal Auth Controller
 * 开发者门户认证 API
 */
import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Res,
  UnauthorizedException,
  ForbiddenException,
  Param,
  Query,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches, Equals, IsIn, IsByteLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Request, Response as ExpressResponse } from 'express';
import { randomBytes } from 'crypto';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthFlowService, OAuthProvider, EmailPurpose, OAuthLinkCallbackException } from './portal-auth-flow.service';
import { PortalLoginThrottleService } from './portal-login-throttle.service';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalUserId } from './decorators/portal-user.decorator';

// ==================== DTOs ====================

class EmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

class RegisterDto extends EmailDto {

  @ApiProperty({ description: '用户名', example: 'john_doe' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  username!: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  password!: string;

  @ApiProperty({ description: '通过 email-code 接口获取的注册验证码', example: '123456' })
  @Matches(/^\d{6}$/)
  verificationCode!: string;

  @ApiProperty({ description: '已同意服务条款和隐私政策，必须为 true', example: true })
  @Equals(true)
  acceptedTerms!: boolean;
}

class LoginDto extends EmailDto {
  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @MaxLength(100)
  password!: string;
}

class EmailCodeDto extends EmailDto {
  @ApiProperty({ description: '验证码用途', enum: ['register', 'reset-password'] })
  @IsIn(['register', 'reset-password'])
  purpose!: EmailPurpose;
}

class ResetPasswordDto extends EmailDto {
  @ApiProperty({ description: '用于 reset-password 的邮箱验证码', example: '123456' })
  @Matches(/^\d{6}$/)
  verificationCode!: string;

  @ApiProperty({ description: '新密码，至少 8 个字符且最多 72 UTF-8 字节' })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  password!: string;
}

class UpdateProfileDto {
  @ApiProperty({ description: '用户名', required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;

  @ApiProperty({ description: '头像 URL', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;
}

class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  @MaxLength(100)
  oldPassword!: string;

  @ApiProperty({ description: '新密码' })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  newPassword!: string;
}


// ==================== Controller ====================

@ApiTags('Portal 认证')
@Controller('v1/auth')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PortalAuthController {
  constructor(
    private readonly portalAuthService: PortalAuthService,
    private readonly loginThrottle: PortalLoginThrottleService,
    private readonly authFlow: PortalAuthFlowService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: '查询可用登录方式（不返回密钥）' })
  providers() {
    return { code: 0, message: 'Success', data: this.authFlow.providers() };
  }

  @Post('email-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送注册或密码重置验证码' })
  async sendEmailCode(@Body() dto: EmailCodeDto, @Req() request: Request) {
    await this.authFlow.reserveEmail(dto.email, dto.purpose, request.ip || request.socket.remoteAddress);
    if (dto.purpose === 'register' || await this.portalAuthService.canResetPassword(dto.email)) {
      await this.authFlow.sendEmailCode(dto.email, dto.purpose);
    }
    return { code: 0, message: 'If this email is eligible, a verification code has been sent', data: { expiresIn: 600, retryAfter: 60 } };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '使用邮箱验证码重置密码' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authFlow.consumeEmailCode(dto.email, 'reset-password', dto.verificationCode);
    await this.portalAuthService.recoverPassword(dto.email, dto.password);
    return { code: 0, message: 'Password reset successfully. Please sign in again' };
  }

  @Get('oauth/:provider')
  @ApiOperation({ summary: '发起 Google / GitHub 登录' })
  async startOAuth(@Param('provider') provider: OAuthProvider, @Query('returnTo') returnTo: unknown,
    @Req() request: Request, @Res() response: ExpressResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const ip = request.ip || request.socket.remoteAddress;
      await this.loginThrottle.consumeOAuth(ip);
      const result = await this.authFlow.startOAuth(provider, returnTo);
      response.cookie('portal_oauth_binding', result.binding, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600000,
      });
      response.redirect(result.url);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const params = new URLSearchParams({
        error: status === 429 ? 'oauth_rate_limited' : status === 503 ? 'oauth_unavailable' : 'oauth_failed',
        returnTo: this.authFlow.returnPath(returnTo),
      });
      if (status === 429) {
        const detail = (error as HttpException).getResponse() as { retryAfter?: number };
        const retryAfter = Number.isFinite(detail?.retryAfter) ? Math.max(1, Math.min(900, Math.ceil(detail.retryAfter!))) : 900;
        params.set('retryAfter', String(retryAfter));
        response.setHeader('Retry-After', retryAfter);
      }
      let publicUrl = '';
      try { publicUrl = this.authFlow.publicUrl(); } catch { /* Same-origin login remains usable if OAuth config is unavailable. */ }
      response.redirect(303, `${publicUrl}/login?${params}`);
    }
  }

  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'Google / GitHub 授权回调' })
  async oauthCallback(@Param('provider') provider: OAuthProvider, @Query() query: Record<string, unknown>,
    @Req() request: Request, @Res() response: ExpressResponse) {
    const publicUrl = this.authFlow.publicUrl();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.clearCookie('portal_oauth_binding', { path: '/' });
    let linking = false;
    try {
      const result = await this.authFlow.finishOAuth(provider, query.state,
        this.getCookie(request, 'portal_oauth_binding'), query.code, query.error);
      linking = !!result.linkAccount;
      const ip = request.ip || request.socket.remoteAddress;
      const session = result.linkAccount
        ? await this.portalAuthService.linkOAuthAccount(provider, result.profile, result.linkAccount, ip, request.headers['user-agent'])
        : await this.portalAuthService.loginWithOAuth(provider, result.profile, ip, request.headers['user-agent']);
      this.setRefreshCookie(response, session.refreshToken);
      response.redirect(`${publicUrl}/auth/callback?returnTo=${encodeURIComponent(result.returnTo)}`);
    } catch (error) {
      if (linking || error instanceof OAuthLinkCallbackException) {
        response.redirect(`${publicUrl}/profile?oauth=link_failed`);
        return;
      }
      const reason = error instanceof ConflictException ? 'email_conflict' : 'oauth_failed';
      response.redirect(`${publicUrl}/login?error=${reason}`);
    }
  }

  @Post('oauth/:provider/link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '为当前账号关联 Google / GitHub 登录' })
  async startOAuthLink(@Param('provider') provider: OAuthProvider, @PortalUserId() userId: string,
    @Req() request: Request, @Res({ passthrough: true }) response: ExpressResponse) {
    this.assertCsrf(request);
    const ip = request.ip || request.socket.remoteAddress;
    await this.loginThrottle.consume(ip, `oauth-link:${userId}`);
    const account = await this.portalAuthService.getOAuthLinkAccount(userId);
    const result = await this.authFlow.startOAuth(provider, '/profile?oauth=linked', account);
    response.cookie('portal_oauth_binding', result.binding, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600000,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { code: 0, message: 'Success', data: { url: result.url } };
  }

  /**
   * 用户注册
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册', description: '使用邮箱、用户名、密码和邮箱验证码注册新用户，必须同意服务条款' })
  @ApiResponse({ status: 201, description: '注册成功' })
  @ApiResponse({ status: 409, description: '邮箱或用户名已存在' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
    await this.authFlow.consumeEmailCode(dto.email, 'register', dto.verificationCode);
    const result = await this.portalAuthService.register(
      dto.email,
      dto.username,
      dto.password,
    );
    this.setRefreshCookie(response, result.refreshToken);

    return {
      code: 0,
      message: 'Registration successful',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    };
  }

  /**
   * 用户登录
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录', description: '使用邮箱和密码登录' })
  @ApiResponse({ status: 200, description: '登录成功' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await this.loginThrottle.consume(ip, dto.email);

    const result = await this.portalAuthService.login(
      dto.email,
      dto.password,
      ip,
      userAgent,
    );
    await this.loginThrottle.reset(ip, dto.email);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      code: 0,
      message: 'Login successful',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    };
  }

  /**
   * 用户登出
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '用户登出', description: '登出并使 Token 失效' })
  @ApiResponse({ status: 200, description: '登出成功' })
  async logout(
    @PortalUserId() userId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
    await this.portalAuthService.logout(userId, this.getRefreshCookie(request));
    response.clearCookie('portal_refresh_token', { path: '/' });
    response.clearCookie('portal_csrf_token', { path: '/' });
    return {
      code: 0,
      message: 'Logout successful',
    };
  }

  /**
   * 刷新 Token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 Token', description: '使用 Refresh Token 获取新的 Access Token' })
  @ApiResponse({ status: 200, description: '刷新成功' })
  @ApiResponse({ status: 401, description: 'Refresh Token 无效或过期' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
    this.assertCsrf(request);
    const refreshToken = this.getRefreshCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const result = await this.portalAuthService.refreshToken(refreshToken);
    this.setRefreshCookie(response, result.refreshToken);
    return {
      code: 0,
      message: 'Token refreshed',
      data: { accessToken: result.accessToken },
    };
  }

  /**
   * 获取当前用户信息
   */
  @Get('me')
  @UseGuards(PortalJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户', description: '获取当前登录用户的详细信息' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getMe(@PortalUserId() userId: string) {
    const user = await this.portalAuthService.getUserById(userId);
    return {
      code: 0,
      message: 'Success',
      data: user,
    };
  }

  /**
   * 更新个人信息
   */
  @Put('me')
  @UseGuards(PortalJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新个人信息', description: '更新用户名、头像等信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateMe(
    @PortalUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.portalAuthService.updateUser(userId, dto);
    return {
      code: 0,
      message: 'Profile updated',
      data: user,
    };
  }

  /**
   * 修改密码
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PortalJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改密码', description: '修改当前用户的密码' })
  @ApiResponse({ status: 200, description: '密码修改成功' })
  @ApiResponse({ status: 400, description: '旧密码错误' })
  async changePassword(
    @PortalUserId() userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.portalAuthService.changePassword(
      userId,
      dto.oldPassword,
      dto.newPassword,
    );
    return {
      code: 0,
      message: 'Password changed successfully',
    };
  }

  private setRefreshCookie(response: ExpressResponse, token: string): void {
    const secure = process.env.NODE_ENV === 'production';
    const maxAge = this.portalAuthService.getRefreshCookieMaxAge();
    response.cookie('portal_refresh_token', token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
    response.cookie(
      'portal_csrf_token',
      randomBytes(32).toString('base64url'),
      {
        httpOnly: false,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge,
      },
    );
  }

  private getRefreshCookie(request: Request): string | undefined {
    return this.getCookie(request, 'portal_refresh_token');
  }

  private assertCsrf(request: Request): void {
    const cookieToken = this.getCookie(request, 'portal_csrf_token');
    const rawHeader = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Invalid CSRF token');
    }
  }

  private getCookie(request: Request, targetName: string): string | undefined {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const name = part.slice(0, separator).trim();
      if (name === targetName) {
        try { return decodeURIComponent(part.slice(separator + 1).trim()); }
        catch { return undefined; }
      }
    }
    return undefined;
  }
}
