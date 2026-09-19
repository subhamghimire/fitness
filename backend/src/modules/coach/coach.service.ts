import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Coach } from "./entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { createPaginatedResponse } from "src/common/dto";
import { CreateCoachDto, UpdateCoachDto, CoachQueryDto, PaginatedCoachResponseDto, CoachResponseDto, PublicCoachResponseDto } from "./dto";
import { CoachAccountStatus, CoachEligibility, CoachProfileVisibility, CoachVerificationStatus } from "./enums";
import { UserRole } from "../users/enums";
import { CoachProfileService } from "../coach-profile/coach-profile.service";
import { CoachVerificationService } from "../coach-verification/coach-verification.service";
import { CoachDocumentStatus } from "../coach-document/enums";

const APPROVED_DOCUMENT_STATUS = CoachDocumentStatus.APPROVED;

@Injectable()
export class CoachService {
  constructor(
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
    private readonly profileService: CoachProfileService,
    private readonly verificationService: CoachVerificationService
  ) {}

  async create(createDto: CreateCoachDto, user: User): Promise<CoachResponseDto> {
    const existing = await this.coachRepository.findOne({ where: { user: { id: user.id } } });
    if (existing) {
      throw new ConflictException("User is already a coach");
    }

    const coach = this.coachRepository.create({
      name: createDto.name?.trim() || user.name,
      verificationStatus: CoachVerificationStatus.PENDING,
      accountStatus: CoachAccountStatus.ACTIVE,
      eligibility: CoachEligibility.ELIGIBLE,
      user
    });

    const saved = await this.coachRepository.save(coach);

    await this.profileService.createDefault(saved.id);
    await this.verificationService.createDefault(saved.id);

    const full = await this.loadFull(saved.id);
    return this.toFullResponseDto(full!);
  }

  async findAll(query: CoachQueryDto, viewerIsAdmin = false): Promise<PaginatedCoachResponseDto> {
    const { search, verificationStatus, page = 1, limit = 20, sortBy = "rank", sortOrder = "DESC" } = query;

    const order: "ASC" | "DESC" = sortOrder === "ASC" ? "ASC" : "DESC";

    const queryBuilder = this.coachRepository
      .createQueryBuilder("coach")
      .leftJoinAndSelect("coach.coachProfile", "profile")
      .loadRelationCountAndMap("coach.documentCount", "coach.documents", "doc", (qb) => qb.where("doc.status = :status", { status: APPROVED_DOCUMENT_STATUS }))
      .where("coach.isDeleted = :isDeleted", { isDeleted: false });

    if (viewerIsAdmin && verificationStatus) {
      queryBuilder.andWhere("coach.verificationStatus = :verificationStatus", { verificationStatus });
    } else {
      // Public discovery only ever surfaces verified, active, eligible, public profiles.
      queryBuilder
        .andWhere("coach.verificationStatus = :verified", { verified: CoachVerificationStatus.VERIFIED })
        .andWhere("coach.accountStatus = :active", { active: CoachAccountStatus.ACTIVE })
        .andWhere("coach.eligibility = :eligible", { eligible: CoachEligibility.ELIGIBLE })
        .andWhere("profile.visibility = :visibility", { visibility: CoachProfileVisibility.PUBLIC });
    }

    if (search) {
      queryBuilder.andWhere("(coach.name ILIKE :search OR profile.bio ILIKE :search)", { search: `%${search}%` });
    }

    const validSortColumns = ["name", "rank", "createdAt", "averageRating"];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : "rank";
    if (sortColumn === "averageRating") {
      queryBuilder.orderBy('"profile"."average_rating"', order, "NULLS LAST");
    } else {
      queryBuilder.orderBy(`coach.${sortColumn}`, order);
    }

    const total = await queryBuilder.getCount();
    queryBuilder.skip((page - 1) * limit).take(limit);

    const coaches = await queryBuilder.getMany();

    return createPaginatedResponse(
      coaches.map((c) => this.toPublicResponseDto(c)),
      total,
      page,
      limit
    );
  }

  async findOne(id: string, actor?: User): Promise<CoachResponseDto> {
    const coach = await this.loadFull(id);

    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    const isOwnerOrAdmin = actor && (actor.id === coach.userId || actor.role === UserRole.ADMIN);
    if (!isOwnerOrAdmin) {
      this.throwIfNotDiscoverable(coach, `Coach with ID "${id}" not found`);
    }

    return this.toFullResponseDto(coach);
  }

  async findOwn(user: User): Promise<CoachResponseDto> {
    const coach = await this.coachRepository.findOne({
      where: { user: { id: user.id }, isDeleted: false },
      relations: { coachProfile: true, coachVerification: true }
    });
    if (!coach) {
      throw new NotFoundException("Coach profile not found for the current user");
    }
    return this.toFullResponseDto(coach);
  }

  async update(id: string, actor: User, updateDto: UpdateCoachDto): Promise<CoachResponseDto> {
    const coach = await this.coachRepository.findOne({ where: { id } });
    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    const isOwner = coach.userId === actor.id;
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException("You do not have permission to update this coach");
    }

    if (isOwner && !isAdmin) {
      if (updateDto.rank !== undefined || updateDto.accountStatus !== undefined || updateDto.eligibility !== undefined) {
        throw new ForbiddenException("Only administrators can modify rank, account status or eligibility");
      }
    }

    if (updateDto.name !== undefined) {
      coach.name = updateDto.name;
    }
    if (isAdmin) {
      if (updateDto.rank !== undefined) coach.rank = updateDto.rank;
      if (updateDto.accountStatus !== undefined) coach.accountStatus = updateDto.accountStatus;
      if (updateDto.eligibility !== undefined) coach.eligibility = updateDto.eligibility;
    }

    const saved = await this.coachRepository.save(coach);
    const full = await this.loadFull(saved.id);
    return this.toFullResponseDto(full!);
  }

  async remove(id: string, actor: User): Promise<{ success: boolean; message: string }> {
    const coach = await this.coachRepository.findOne({ where: { id } });
    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    const isOwner = coach.userId === actor.id;
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException("You do not have permission to delete this coach");
    }

    coach.isDeleted = true;
    coach.deletedAt = new Date();
    coach.deletedBy = actor.id;
    coach.accountStatus = CoachAccountStatus.INACTIVE;
    await this.coachRepository.save(coach);

    return { success: true, message: `Coach "${coach.name}" disabled successfully` };
  }

  async enableDisable(id: string, actor: User): Promise<CoachResponseDto> {
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isAdmin) {
      throw new ForbiddenException("Only administrators can enable or disable a coach");
    }

    const coach = await this.coachRepository.findOne({ where: { id } });
    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    coach.isDeleted = !coach.isDeleted;
    coach.deletedAt = coach.isDeleted ? new Date() : null;
    coach.deletedBy = coach.isDeleted ? actor.id : null;
    coach.accountStatus = coach.isDeleted ? CoachAccountStatus.INACTIVE : CoachAccountStatus.ACTIVE;
    const saved = await this.coachRepository.save(coach);
    return this.toFullResponseDto((await this.loadFull(saved.id)) as Coach & { documentCount?: number });
  }

  async count(): Promise<number> {
    return this.coachRepository.count({
      where: {
        isDeleted: false,
        verificationStatus: CoachVerificationStatus.VERIFIED,
        accountStatus: CoachAccountStatus.ACTIVE,
        eligibility: CoachEligibility.ELIGIBLE
      }
    });
  }

  async getVerifiedCoaches(): Promise<PublicCoachResponseDto[]> {
    return this.findAll({ verificationStatus: CoachVerificationStatus.VERIFIED, sortBy: "rank", sortOrder: "DESC" } as CoachQueryDto).then((res) => res.data);
  }

  private async loadFull(id: string): Promise<Coach | null> {
    return this.coachRepository
      .createQueryBuilder("coach")
      .leftJoinAndSelect("coach.coachProfile", "profile")
      .leftJoinAndSelect("coach.coachVerification", "verification")
      .loadRelationCountAndMap("coach.documentCount", "coach.documents", "doc", (qb) => qb.where("doc.status = :status", { status: APPROVED_DOCUMENT_STATUS }))
      .where("coach.id = :id", { id })
      .getOne();
  }

  private throwIfNotDiscoverable(coach: Coach, message: string): void {
    const discoverable =
      coach.verificationStatus === CoachVerificationStatus.VERIFIED &&
      coach.accountStatus === CoachAccountStatus.ACTIVE &&
      coach.eligibility === CoachEligibility.ELIGIBLE &&
      !coach.isDeleted &&
      coach.coachProfile?.visibility === CoachProfileVisibility.PUBLIC;
    if (!discoverable) {
      throw new NotFoundException(message);
    }
  }

  private toPublicResponseDto(coach: Coach & { documentCount?: number }): PublicCoachResponseDto {
    const profile = coach.coachProfile ? this.profileService.toPublicDto(coach.coachProfile) : null;
    return {
      id: coach.id,
      name: coach.name,
      rank: coach.rank,
      verificationStatus: coach.verificationStatus,
      profile,
      documentCount: coach.documentCount,
      createdAt: coach.createdAt
    };
  }

  private toFullResponseDto(coach: Coach & { documentCount?: number }): CoachResponseDto {
    return {
      id: coach.id,
      name: coach.name,
      verificationStatus: coach.verificationStatus,
      accountStatus: coach.accountStatus,
      eligibility: coach.eligibility,
      rank: coach.rank,
      profile: coach.coachProfile ? this.profileService.toResponseDto(coach.coachProfile) : undefined,
      coachVerification: coach.coachVerification ? this.verificationService.toResponseDto(coach.coachVerification) : undefined,
      documentCount: coach.documentCount,
      createdAt: coach.createdAt,
      updatedAt: coach.updatedAt
    };
  }
}
