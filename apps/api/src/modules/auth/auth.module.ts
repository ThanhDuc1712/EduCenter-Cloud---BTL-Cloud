import { Body, Controller, Get, HttpCode, HttpStatus, Module, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SessionRequest } from '../../common/auth/session.service';
import { AnyRole, CurrentPrincipal, PublicPolicy } from '../../common/authz/policy.decorator';
import { AppConfigService } from '../../common/config/app-config.service';
import { DemoContextService } from '../../common/context/demo-context.service';
import type { Principal } from '../../common/context/principal';
import { contextPayload } from '../context/context.payload';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import { LoginRateLimiter } from './login-rate-limiter';

/**
 * `/auth/*`. login / register / logout are public (they create or end the session) but still pass
 * the guard's same-origin check; change-password needs a session. Login and register answer with
 * the same body as `GET /context`.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly demo: DemoContextService,
    private readonly config: AppConfigService,
  ) {}

  @Get('options')
  @PublicPolicy()
  options() {
    return this.auth.options();
  }

  @Post('login')
  @PublicPolicy()
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return contextPayload(await this.auth.login(req, res, dto), this.demo, this.config);
  }

  @Post('register')
  @PublicPolicy()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return contextPayload(await this.auth.register(req, res, dto), this.demo, this.config);
  }

  @Post('logout')
  @PublicPolicy()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
  }

  @Post('change-password')
  @AnyRole()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentPrincipal() p: Principal, @Body() dto: ChangePasswordDto, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.changePassword(p, req, res, dto);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService, LoginRateLimiter] })
export class AuthModule {}
