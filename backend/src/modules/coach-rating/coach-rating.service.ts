import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachRating } from './entities/coach-rating.entity';
import { createPaginatedResponse } from 'src/common/dto';
import { CreateCoachRatingDto, UpdateCoachRatingDto, CoachRatingQueryDto, PaginatedCoachRatingResponseDto, CoachRatingResponseDto, CoachRatingStatsDto } from './dto';

@Injectable()
export class CoachRatingService {
  constructor(
    @InjectRepository(CoachRating)
    private readonly repository: Repository<CoachRating>
  ) {}

  async create(userId: string, dto: CreateCoachRatingDto): Promise<CoachRatingResponseDto> {
    const existing = await this.repository.findOne({ where: { coachId: dto.coachId, userId } });
    if (existing) throw new ConflictException('You already rated this coach');

    const rating = this.repository.create({ ...dto, userId });
    const saved = await this.repository.save(rating);
    return this.toResponseDto(saved);
  }

  async findAll(query: CoachRatingQueryDto): Promise<PaginatedCoachRatingResponseDto> {
    const { coachId, page = 1, limit = 20, sortOrder = 'DESC' } = query;
    const qb = this.repository.createQueryBuilder('rating');

    if (coachId) qb.andWhere('rating.coachId = :coachId', { coachId });
    qb.orderBy('rating.createdAt', sortOrder === 'ASC' ? 'ASC' : 'DESC');

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const ratings = await qb.getMany();

    return createPaginatedResponse(ratings.map(r => this.toResponseDto(r)), total, page, limit);
  }

  async findOne(id: string): Promise<CoachRatingResponseDto> {
    const rating = await this.repository.findOne({ where: { id } });
    if (!rating) throw new NotFoundException('Rating not found');
    return this.toResponseDto(rating);
  }

  async update(userId: string, id: string, dto: UpdateCoachRatingDto): Promise<CoachRatingResponseDto> {
    const rating = await this.repository.findOne({ where: { id, userId } });
    if (!rating) throw new NotFoundException('Rating not found');
    Object.assign(rating, dto);
    const saved = await this.repository.save(rating);
    return this.toResponseDto(saved);
  }

  async remove(userId: string, id: string): Promise<{ success: boolean; message: string }> {
    const rating = await this.repository.findOne({ where: { id, userId } });
    if (!rating) throw new NotFoundException('Rating not found');
    await this.repository.remove(rating);
    return { success: true, message: 'Rating deleted' };
  }

  async getCoachStats(coachId: string): Promise<CoachRatingStatsDto> {
    const result = await this.repository
      .createQueryBuilder('rating')
      .select('AVG(rating.ratingNo)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('rating.coachId = :coachId', { coachId })
      .getRawOne();

    const distribution = await this.repository
      .createQueryBuilder('rating')
      .select('rating.ratingNo', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('rating.coachId = :coachId', { coachId })
      .groupBy('rating.ratingNo')
      .getRawMany();

    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach(d => { dist[d.rating] = parseInt(d.count); });

    return {
      averageRating: parseFloat(result.avg) || 0,
      totalRatings: parseInt(result.count) || 0,
      distribution: dist
    };
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
