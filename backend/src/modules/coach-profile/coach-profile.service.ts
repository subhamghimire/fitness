import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Coach } from "../coach/entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { CoachProfile } from "./entities/coach-profile.entity";
import { UpdateCoachProfileDto, CoachProfileResponseDto, PublicCoachProfileDto } from "./dto";
import { CoachProfileVisibility } from "../coach/enums";
import { FilesService } from "../files/files.service";
import { FileFolder } from "../files/enums/file-folder.enum";

@Injectable()
export class CoachProfileService {
  constructor(
    @InjectRepository(CoachProfile)
    private readonly profileRepository: Repository<CoachProfile>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
    private readonly filesService: FilesService
  ) {}

  async createDefault(coachId: string): Promise<CoachProfile> {
    const profile = this.profileRepository.create({
      coachId,
      visibility: CoachProfileVisibility.PUBLIC,
      averageRating: 0,
      ratingCount: 0
    });
    return this.profileRepository.save(profile);
  }

  async getOwnProfile(user: User): Promise<CoachProfileResponseDto> {
    const coach = await this.findCoachByUser(user.id);
    const profile = await this.findOrCreateProfile(coach.id);
    return this.toResponseDto(profile);
  }

  async updateOwnProfile(user: User, dto: UpdateCoachProfileDto): Promise<CoachProfileResponseDto> {
    const coach = await this.findCoachByUser(user.id);
    const profile = await this.findOrCreateProfile(coach.id);

    if (dto.avatarImageId !== undefined && dto.avatarImageId !== null) {
      await this.assertFileOwned(dto.avatarImageId, user);
    }

    Object.assign(profile, this.pickDefined(dto));
    const saved = await this.profileRepository.save(profile);
    return this.toResponseDto(saved);
  }

  async findByCoachId(coachId: string): Promise<CoachProfile | null> {
    return this.profileRepository.findOne({ where: { coachId } });
  }

  async findOrCreateProfile(coachId: string): Promise<CoachProfile> {
    const existing = await this.findByCoachId(coachId);
    if (existing) return existing;
    return this.createDefault(coachId);
  }

  async updateRatingSummary(coachId: string, averageRating: number, ratingCount: number): Promise<void> {
    await this.profileRepository.update({ coachId }, { averageRating, ratingCount });
  }

  toPublicDto(profile: CoachProfile | null): PublicCoachProfileDto | null {
    if (!profile) return null;
    return {
      bio: profile.bio,
      tagline: profile.tagline,
      specialties: profile.specialties,
      experienceYears: profile.experienceYears,
      certifications: profile.certifications,
      websiteUrl: profile.websiteUrl,
      socialLinks: profile.socialLinks,
      averageRating: Number(profile.averageRating) || 0,
      ratingCount: profile.ratingCount || 0
    };
  }

  toResponseDto(profile: CoachProfile): CoachProfileResponseDto {
    return {
      coachId: profile.coachId,
      bio: profile.bio,
      tagline: profile.tagline,
      specialties: profile.specialties,
      experienceYears: profile.experienceYears,
      certifications: profile.certifications,
      websiteUrl: profile.websiteUrl,
      socialLinks: profile.socialLinks,
      avatarImageId: profile.avatarImageId,
      visibility: profile.visibility,
      averageRating: Number(profile.averageRating) || 0,
      ratingCount: profile.ratingCount || 0,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  private async findCoachByUser(userId: string): Promise<Coach> {
    const coach = await this.coachRepository.findOne({ where: { user: { id: userId } } });
    if (!coach) {
      throw new NotFoundException("Coach profile not found for the current user");
    }
    return coach;
  }

  private async assertFileOwned(fileId: string, user: User): Promise<void> {
    const owned = await this.filesService.isFileAccessible(fileId, user, FileFolder.COACH_PROFILE);
    if (!owned) {
      throw new BadRequestException("The provided avatar file is not owned by the current user");
    }
  }

  private pickDefined(dto: UpdateCoachProfileDto): Partial<CoachProfile> {
    const keys = ["bio", "tagline", "specialties", "experienceYears", "certifications", "websiteUrl", "socialLinks", "visibility", "avatarImageId"] as const;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }
}
