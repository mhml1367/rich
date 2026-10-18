import { Body, Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('otp/request')
  requestOtp(@Body() input: { phone?: string; displayName?: string; mode?: string }) {
    return this.auth.requestOtp(input);
  }

  @Post('otp/verify')
  verifyOtp(@Body() input: { phone?: string; code?: string }) {
    return this.auth.verifyOtp(input);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.auth.authenticate(this.bearer(authorization));
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    return this.auth.logout(this.bearer(authorization));
  }

  private bearer(value?: string) {
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('phone_session_required');
    return value.slice(7);
  }
}
