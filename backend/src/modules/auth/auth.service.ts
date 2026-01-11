import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtPayload } from './strategies/jwt.strategy';
@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private usersRepository: Repository<User>, private jwtService: JwtService) {}
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.usersRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already registered');
    const user = this.usersRepository.create({ id: uuidv4(), email: dto.email.toLowerCase(), password: await bcrypt.hash(dto.password, 10) });
    await this.usersRepository.save(user);
    return { token: this.generateToken(user), user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() } };
  }
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) throw new UnauthorizedException('Invalid credentials');
    return { token: this.generateToken(user), user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() } };
  }
  async getProfile(user: User) { return { user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() } }; }
  private generateToken(user: User): string { const payload: JwtPayload = { sub: user.id, email: user.email }; return this.jwtService.sign(payload); }
}
