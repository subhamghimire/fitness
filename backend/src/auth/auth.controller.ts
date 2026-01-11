import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('register') register(@Body() dto: RegisterDto): Promise<AuthResponseDto> { return this.authService.register(dto); }
  @Post('login') @HttpCode(HttpStatus.OK) login(@Body() dto: LoginDto): Promise<AuthResponseDto> { return this.authService.login(dto); }
  @Get('profile') @UseGuards(JwtAuthGuard) getProfile(@CurrentUser() user: User) { return this.authService.getProfile(user); }
}
