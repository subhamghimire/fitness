import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "./entities/user.entity";
import { UpdateUserDto, UserQueryDto, ChangePasswordDto, UserResponseDto } from "./dto";
import { ConfigService } from "@nestjs/config";
import { createPaginatedResponse } from "src/common/dto";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService
  ) {}

  async getAll(query: UserQueryDto) {
    const { page = 1, limit = 10, search, age, gender, createdFrom, createdTo, isDeleted } = query;

    const qb = this.userRepo.createQueryBuilder("user").leftJoinAndSelect("user.avatar", "avatar");

    if (search) qb.andWhere("user.name ILIKE :search OR user.email ILIKE :search", { search: `%${search}%` });
    if (age !== undefined) qb.andWhere("user.age = :age", { age });
    if (gender !== undefined) qb.andWhere("user.gender = :gender", { gender });
    if (createdFrom) qb.andWhere("user.createdAt >= :createdFrom", { createdFrom });
    if (createdTo) qb.andWhere("user.createdAt <= :createdTo", { createdTo });
    if (isDeleted !== undefined) qb.andWhere("user.isDeleted = :isDeleted", { isDeleted });

    qb.skip((page - 1) * limit).take(limit);

    const [users, total] = await qb.getManyAndCount();

    return createPaginatedResponse(
      users.map((e) => this.toResponseDto(e)),
      total,
      page,
      limit
    );
  }

  async getProfile(id: string): Promise<UserResponseDto> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { avatar: true } });
    if (!user) throw new NotFoundException("User not found");

    return this.toResponseDto(user);
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    // Check email uniqueness
    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existing) throw new BadRequestException("Email already exists");
    }

    Object.assign(user, dto);

    const savedUser = await this.userRepo.save(user);
    return this.toResponseDto(savedUser);
  }

  async enableDisable(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    user.isDeleted = !user.isDeleted;
    const savedUser = await this.userRepo.save(user);

    return {
      success: true,
      isDeleted: savedUser.isDeleted,
      user: this.toResponseDto(savedUser)
    };
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.userRepo.findOne({ where: { id }, select: ["id", "password"] });
    if (!user) throw new NotFoundException("User not found");

    // Validate old password
    const valid = await bcrypt.compare(dto.oldPassword, user.password);
    if (!valid) throw new BadRequestException("Old password is incorrect");

    // Validate new vs confirm password
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException("New password and confirm password do not match");
    }

    // Optional: prevent same as old password
    const isSameAsOld = await bcrypt.compare(dto.newPassword, user.password);
    if (isSameAsOld) throw new BadRequestException("New password cannot be the same as old password");

    // Hash and save new password
    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);

    return { success: true };
  }

  private toResponseDto(user: User): UserResponseDto {
    return {
      ...user,
      avatar: user.avatar ? `${this.configService.get<string>("APP_URL")}/${user.avatar.path}` : null
    };
  }
}
