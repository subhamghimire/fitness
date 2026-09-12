import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "./entities/user.entity";
import { UpdateUserDto, UpdateMeDto, UserQueryDto, ChangePasswordDto, UserResponseDto } from "./dto";
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

  async updateMe(id: string, dto: UpdateMeDto): Promise<UserResponseDto> {
    return this.updateUser(id, dto);
  }

  async updateUser(id: string, dto: UpdateUserDto | UpdateMeDto): Promise<UserResponseDto> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { avatar: true } });
    if (!user) throw new NotFoundException("User not found");

    if ("email" in dto && dto.email && dto.email !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existing) throw new BadRequestException("Email already exists");
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.age !== undefined) user.age = dto.age;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if ("email" in dto && dto.email !== undefined) user.email = dto.email;

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
    const appUrl = this.configService.get<string>("APP_URL") || "";
    const avatar = user.avatar?.path ? `${appUrl}/${user.avatar.path}` : null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      age: user.age,
      gender: user.gender,
      avatar,
      photoUrl: user.googlePhotoUrl || avatar || null,
      isDeleted: user.isDeleted,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }
}
