import { Injectable, ConflictException, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, createHash } from 'crypto';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { 
  AuthResponseDto, 
  TokensResponseDto, 
  UserResponseDto,
  RefreshTokenResponseDto,
  MessageResponseDto
} from './dto/auth-response.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly accessTokenExpiry: number;
  private readonly refreshTokenExpiry: number;

  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
    @InjectRepository(RefreshToken) private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken) private passwordResetRepository: Repository<PasswordResetToken>,
    private jwtService: JwtService,
    private configService: ConfigService
  ) {
    this.accessTokenExpiry = parseInt(this.configService.get('JWT_ACCESS_EXPIRY') || '900'); // 15 min
    this.refreshTokenExpiry = parseInt(this.configService.get('JWT_REFRESH_EXPIRY') || '604800'); // 7 days
  }

  async register(dto: RegisterDto, userAgent?: string, ipAddress?: string): Promise<AuthResponseDto> {
    const existing = await this.usersRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already registered');

    const user = this.usersRepository.create({
      id: uuidv4(),
      name: dto.name || dto.email.split('@')[0],
      email: dto.email.toLowerCase(),
      password: await bcrypt.hash(dto.password, 10)
    });
    await this.usersRepository.save(user);

    const tokens = await this.generateTokens(user, userAgent, ipAddress);
    return { tokens, user: this.toUserResponse(user) };
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string): Promise<AuthResponseDto> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
      select: ['id', 'email', 'name', 'password', 'createdAt']
    });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user, userAgent, ipAddress);
    return { tokens, user: this.toUserResponse(user) };
  }

  async refreshTokens(refreshToken: string, userAgent?: string, ipAddress?: string): Promise<RefreshTokenResponseDto> {
    const hashedToken = this.hashToken(refreshToken);
    const storedToken = await this.refreshTokenRepository.findOne({
      where: { token: hashedToken, isRevoked: false, expiresAt: MoreThan(new Date()) },
      relations: ['user']
    });

    if (!storedToken) throw new UnauthorizedException('Invalid or expired refresh token');

    // Revoke old token
    storedToken.isRevoked = true;
    await this.refreshTokenRepository.save(storedToken);

    // Generate new tokens
    const tokens = await this.generateTokens(storedToken.user, userAgent, ipAddress);
    return { tokens };
  }

  async logout(refreshToken: string): Promise<MessageResponseDto> {
    const hashedToken = this.hashToken(refreshToken);
    await this.refreshTokenRepository.update({ token: hashedToken }, { isRevoked: true });
    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: string): Promise<MessageResponseDto> {
    await this.refreshTokenRepository.update({ userId, isRevoked: false }, { isRevoked: true });
    return { message: 'All sessions logged out successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    const user = await this.usersRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    
    // Always return success to prevent email enumeration
    if (!user) return { message: 'If email exists, reset instructions have been sent' };

    // Invalidate existing reset tokens
    await this.passwordResetRepository.update({ userId: user.id, isUsed: false }, { isUsed: true });

    // Create new reset token (valid for 1 hour)
    const token = randomBytes(32).toString('hex');
    const resetToken = this.passwordResetRepository.create({
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600000) // 1 hour
    });
    await this.passwordResetRepository.save(resetToken);

    // TODO: Send email with reset link
    // Email should contain: `${APP_URL}/reset-password?token=${token}`
    console.log(`Password reset token for ${user.email}: ${token}`);

    return { message: 'If email exists, reset instructions have been sent' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponseDto> {
    const resetToken = await this.passwordResetRepository.findOne({
      where: { token: dto.token, isUsed: false, expiresAt: MoreThan(new Date()) },
      relations: ['user']
    });

    if (!resetToken) throw new BadRequestException('Invalid or expired reset token');

    // Update password
    resetToken.user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepository.save(resetToken.user);

    // Mark token as used
    resetToken.isUsed = true;
    await this.passwordResetRepository.save(resetToken);

    // Revoke all refresh tokens for security
    await this.refreshTokenRepository.update({ userId: resetToken.userId }, { isRevoked: true });

    return { message: 'Password reset successfully' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<MessageResponseDto> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'password']
    });

    if (!user) throw new NotFoundException('User not found');

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async getProfile(user: User): Promise<{ user: UserResponseDto }> {
    return { user: this.toUserResponse(user) };
  }

  private async generateTokens(user: User, userAgent?: string, ipAddress?: string): Promise<TokensResponseDto> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    
    const accessToken = this.jwtService.sign(payload, { expiresIn: this.accessTokenExpiry });
    const refreshToken = randomBytes(64).toString('hex');

    // Store hashed refresh token
    const hashedToken = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.refreshTokenExpiry * 1000);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        token: hashedToken,
        userId: user.id,
        expiresAt,
        userAgent,
        ipAddress
      })
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpiry
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toUserResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString()
    };
  }
}
