import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CoachVerification } from "./entities/coach-verification.entity";
import { UpdateCoachVerificationDto, CoachVerificationResponseDto } from "./dto";
import { Coach } from "../coach/entities/coach.entity";
import { CoachVerificationStatus } from "./enums";
import { User } from "../users/entities/user.entity";

const VERIFICATION_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class CoachVerificationService {
  constructor(
    @InjectRepository(CoachVerification)
    private readonly verificationRepository: Repository<CoachVerification>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>
  ) {}

  async createDefault(coachId: string): Promise<CoachVerification> {
    const verification = this.verificationRepository.create({
      coachId,
      status: CoachVerificationStatus.PENDING
    });
    return this.verificationRepository.save(verification);
  }

  async findOrCreateForCoach(coachId: string): Promise<CoachVerification> {
    const existing = await this.verificationRepository.findOne({ where: { coachId } });
    if (existing) return existing;
    return this.createDefault(coachId);
  }

  async getOwnVerification(user: User): Promise<CoachVerificationResponseDto> {
    const coach = await this.findCoachByUser(user.id);
    const verification = await this.findOrCreateForCoach(coach.id);
    await this.refreshExpiry(verification, coach);
    return this.toResponseDto(verification);
  }

  async submitOwn(user: User): Promise<CoachVerificationResponseDto> {
    const coach = await this.findCoachByUser(user.id);
    const verification = await this.findOrCreateForCoach(coach.id);
    verification.status = CoachVerificationStatus.PENDING;
    verification.submittedAt = new Date();
    verification.reviewedAt = null;
    verification.reviewedBy = null;
    verification.decisionNote = null;
    verification.expiresAt = null;
    await this.verificationRepository.save(verification);

    await this.syncCoachStatus(coach, CoachVerificationStatus.PENDING);
    return this.toResponseDto(verification);
  }

  async getByCoachId(coachId: string): Promise<CoachVerificationResponseDto> {
    const verification = await this.verificationRepository.findOne({ where: { coachId } });
    if (!verification) {
      throw new NotFoundException(`Verification record for coach "${coachId}" not found`);
    }
    const coach = await this.coachRepository.findOne({ where: { id: coachId } });
    if (coach) {
      await this.refreshExpiry(verification, coach);
    }
    return this.toResponseDto(verification);
  }

  async transition(coachId: string, dto: UpdateCoachVerificationDto, admin: User): Promise<CoachVerificationResponseDto> {
    const coach = await this.coachRepository.findOne({ where: { id: coachId } });
    if (!coach) {
      throw new NotFoundException(`Coach with ID "${coachId}" not found`);
    }

    if (dto.status === CoachVerificationStatus.PENDING) {
      throw new BadRequestException("Pending is the coach-submitted state and cannot be set by an administrator");
    }

    const verification = await this.findOrCreateForCoach(coachId);

    const now = new Date();
    verification.status = dto.status;
    verification.reviewedAt = now;
    verification.reviewedBy = admin.id;
    if (dto.decisionNote !== undefined) {
      verification.decisionNote = dto.decisionNote;
    }
    if (dto.status === CoachVerificationStatus.VERIFIED) {
      verification.expiresAt = dto.expiresAt ?? new Date(now.getTime() + VERIFICATION_VALIDITY_MS);
    }
    if (dto.status === CoachVerificationStatus.UNDER_REVIEW) {
      verification.submittedAt = verification.submittedAt ?? now;
    }
    await this.verificationRepository.save(verification);

    await this.syncCoachStatus(coach, dto.status);
    return this.toResponseDto(verification);
  }

  private async syncCoachStatus(coach: Coach, status: CoachVerificationStatus): Promise<void> {
    coach.verificationStatus = status;
    await this.coachRepository.save(coach);
  }

  /**
   * A verification that has passed its expiry date is no longer valid.
   * Lazily transitions it to EXPIRED and mirrors the state on the coach.
   */
  private async refreshExpiry(verification: CoachVerification, coach: Coach): Promise<void> {
    if (verification.status === CoachVerificationStatus.VERIFIED && verification.expiresAt && verification.expiresAt.getTime() <= Date.now()) {
      verification.status = CoachVerificationStatus.EXPIRED;
      await this.verificationRepository.save(verification);
      await this.syncCoachStatus(coach, CoachVerificationStatus.EXPIRED);
    }
  }

  private async findCoachByUser(userId: string): Promise<Coach> {
    const coach = await this.coachRepository.findOne({ where: { user: { id: userId } } });
    if (!coach) {
      throw new NotFoundException("Coach profile not found for the current user");
    }
    return coach;
  }

  toResponseDto(verification: CoachVerification): CoachVerificationResponseDto {
    return {
      coachId: verification.coachId,
      status: verification.status,
      submittedAt: verification.submittedAt,
      reviewedAt: verification.reviewedAt,
      reviewedBy: verification.reviewedBy,
      decisionNote: verification.decisionNote,
      expiresAt: verification.expiresAt,
      createdAt: verification.createdAt,
      updatedAt: verification.updatedAt
    };
  }
}
