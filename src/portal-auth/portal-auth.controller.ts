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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import { Request, Response as ExpressResponse } from 'express';
import { randomBytes } from 'crypto';
import { PortalAuthService } from './portal-auth.service';
import { PortalLoginThrottleService } from './portal-login-throttle.service';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalUser, PortalUserId, PortalUserPayload } from './decorators/portal-user.decorator';

// ==================== DTOs ====================

class RegisterDto {
  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '用户名', example: 'john_doe' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username!: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}

class LoginDto {
  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @MaxLength(100)
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
  @MaxLength(100)
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
  ) {}

  /**
   * 用户注册
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册', description: '使用邮箱、用户名、密码注册新用户' })
  @ApiResponse({ status: 201, description: '注册成功' })
  @ApiResponse({ status: 409, description: '邮箱或用户名已存在' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
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
    const maxAge =
      Number(process.env.PORTAL_REFRESH_TOKEN_EXPIRES_DAYS ?? 7) *
      24 *
      60 *
      60 *
      1000;
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
        return decodeURIComponent(part.slice(separator + 1).trim());
      }
    }
    return undefined;
  }
}
