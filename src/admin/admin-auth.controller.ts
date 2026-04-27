import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';

class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: '密码', example: 'changeme123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

@ApiTags('管理后台 - 认证')
@Controller('api/v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员登录', description: '使用用户名密码登录，返回 JWT Token' })
  @ApiResponse({ status: 200, description: '登录成功，返回 accessToken' })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto.username, dto.password);
    return { code: 0, message: 'Login successful', data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '管理员登出', description: '登出并清除权限缓存' })
  @ApiResponse({ status: 200, description: '登出成功' })
  async logout(@Req() req: any) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    if (userId) {
      await this.authService.logout(userId);
    }
    return { code: 0, message: 'Logout successful' };
  }
}
