import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CoachRating } from "./entities/coach-rating.entity";
import { Coach } from "../coach/entities/coach.entity";
import { CoachAccountStatus, CoachEligibility, CoachProfileVisibility, CoachVerificationStatus } from "../coach/enums";
import { CoachProfileService } from "../coach-profile/coach-profile.service";
import { createPaginatedResponse } from "src/common/dto";
import { CreateCoachRatingDto, UpdateCoachRatingDto, CoachRatingQueryDto, PaginatedCoachRatingResponseDto, CoachRatingResponseDto, CoachRatingStatsDto } from "./dto";

@Injectable()
export class CoachRatingService {
  constructor(
    @InjectRepository(CoachRating)
    private readonly repository: Repository<CoachRating>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
    private readonly profileService: CoachProfileService
  ) {}

  async create(userId: string, dto: CreateCoachRatingDto): Promise<CoachRatingResponseDto> {
    await this.assertRatableCoach(dto.coachId, userId);

    const existing = await this.repository.findOne({ where: { coachId: dto.coachId, userId } });
    if (existing) throw new ConflictException("You already rated this coach");

    const rating = this.repository.create({ ...dto, userId });
    const saved = await this.repository.save(rating);
    await this.recalculateSummary(dto.coachId);
    return this.toResponseDto(saved);
  }

  async findAll(query: CoachRatingQueryDto): Promise<PaginatedCoachRatingResponseDto> {
    const { coachId, page = 1, limit = 20, sortOrder = "DESC" } = query;
    const qb = this.repository.createQueryBuilder("rating").where("rating.isDeleted = :isDeleted", { isDeleted: false });

    if (coachId) qb.andWhere("rating.coachId = :coachId", { coachId });
    qb.orderBy("rating.createdAt", sortOrder === "ASC" ? "ASC" : "DESC");

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const ratings = await qb.getMany();

    return createPaginatedResponse(
      ratings.map((r) => this.toResponseDto(r)),
      total,
      page,
      limit
    );
  }

  async findOne(id: string): Promise<CoachRatingResponseDto> {
    const rating = await this.repository.findOne({ where: { id, isDeleted: false } });
    if (!rating) throw new NotFoundException("Rating not found");
    return this.toResponseDto(rating);
  }

  async update(userId: string, id: string, dto: UpdateCoachRatingDto): Promise<CoachRatingResponseDto> {
    const rating = await this.repository.findOne({ where: { id, userId, isDeleted: false } });
    if (!rating) throw new NotFoundException("Rating not found");
    Object.assign(rating, dto);
    const saved = await this.repository.save(rating);
    await this.recalculateSummary(rating.coachId);
    return this.toResponseDto(saved);
  }

  async remove(userId: string, id: string): Promise<{ success: boolean; message: string }> {
    const rating = await this.repository.findOne({ where: { id, userId, isDeleted: false } });
    if (!rating) throw new NotFoundException("Rating not found");
    rating.isDeleted = true;
    rating.deletedAt = new Date();
    rating.deletedBy = userId;
    await this.repository.save(rating);
    await this.recalculateSummary(rating.coachId);
    return { success: true, message: "Rating deleted" };
  }

  async getCoachStats(coachId: string): Promise<CoachRatingStatsDto> {
    const result = await this.repository
      .createQueryBuilder("rating")
      .select("AVG(rating.ratingNo)", "avg")
      .addSelect("COUNT(*)", "count")
      .where("rating.coachId = :coachId", { coachId })
      .andWhere("rating.isDeleted = :isDeleted", { isDeleted: false })
      .getRawOne<{ avg: string | null; count: string }>();

    const distribution = await this.repository
      .createQueryBuilder("rating")
      .select("rating.ratingNo", "rating")
      .addSelect("COUNT(*)", "count")
      .where("rating.coachId = :coachId", { coachId })
      .andWhere("rating.isDeleted = :isDeleted", { isDeleted: false })
      .groupBy("rating.ratingNo")
      .getRawMany<{ rating: number; count: string }>();

    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach((d) => {
      dist[d.rating] = parseInt(d.count, 10);
    });

    return {
      averageRating: parseFloat(result?.avg ?? "") || 0,
      totalRatings: parseInt(result?.count ?? "0", 10) || 0,
      distribution: dist
    };
  }

  private async recalculateSummary(coachId: string): Promise<void> {
    const stats = await this.getCoachStats(coachId);
    await this.profileService.updateRatingSummary(coachId, stats.averageRating, stats.totalRatings);
  }

  /**
   * Guard against obviously invalid ratings: a user cannot rate their own
   * coach account, and only coaches that are publicly discoverable
   * (verified, active, eligible and public) can accumulate ratings.
   */
  private async assertRatableCoach(coachId: string, userId: string): Promise<void> {
    const coach = await this.coachRepository.findOne({
      where: { id: coachId },
      relations: { coachProfile: true }
    });

    if (!coach) {
      throw new NotFoundException(`Coach with ID "${coachId}" not found`);
    }

    if (coach.userId === userId) {
      throw new ForbiddenException("You cannot rate your own coach profile");
    }

    const profile = coach.coachProfile;
    const discoverable =
      coach.verificationStatus === CoachVerificationStatus.VERIFIED &&
      coach.accountStatus === CoachAccountStatus.ACTIVE &&
      coach.eligibility === CoachEligibility.ELIGIBLE &&
      !coach.isDeleted &&
      profile != null &&
      profile.visibility === CoachProfileVisibility.PUBLIC;

    if (!discoverable) {
      throw new BadRequestException("This coach is not currently available for rating");
    }
  }

  private toResponseDto(rating: CoachRating): CoachRatingResponseDto {
    return {
      id: rating.id,
      coachId: rating.coachId,
      userId: rating.userId,
      ratingNo: rating.ratingNo,
      comment: rating.comment,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt
    };
  }
}
