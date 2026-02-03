import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coach } from './entities/coach.entity';
import { User } from '../users/entities/user.entity';
import { createPaginatedResponse } from 'src/common/dto';
import {
  CreateCoachDto,
  UpdateCoachDto,
  CoachQueryDto,
  PaginatedCoachResponseDto,
  CoachResponseDto
} from './dto';

@Injectable()
export class CoachService {
  constructor(
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>
  ) {}

  async create(createDto: CreateCoachDto, user: User): Promise<CoachResponseDto> {
    const existingCoach = await this.coachRepository.findOne({ where: { user: { id: user.id } } });
    if (existingCoach) {
      throw new ConflictException('User is already a coach');
    }

    const coach = this.coachRepository.create({
      ...createDto,
      user
    });
    
    // Default name to user's name if not provided (though dto validation requires it currently)
    // If we make name optional in DTO later, this would be useful:
    // if (!coach.name) coach.name = user.name;

    const saved = await this.coachRepository.save(coach);
    return this.toResponseDto(saved);
  }

  async findAll(query: CoachQueryDto): Promise<PaginatedCoachResponseDto> {
    const { search, isVerified, page = 1, limit = 20, sortBy = 'rank', sortOrder = 'DESC' } = query;

    const queryBuilder = this.coachRepository
      .createQueryBuilder('coach')
      .loadRelationCountAndMap('coach.documentCount', 'coach.documents');

    // Apply search filter
    if (search) {
      queryBuilder.andWhere(
        '(coach.name ILIKE :search OR coach.bio ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Apply verified filter
    if (isVerified !== undefined) {
      queryBuilder.andWhere('coach.isVerified = :isVerified', { isVerified });
    }

    // Apply sorting
    const validSortColumns = ['name', 'rank', 'createdAt'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'rank';
    queryBuilder.orderBy(`coach.${sortColumn}`, sortOrder === 'ASC' ? 'ASC' : 'DESC');

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const coaches = await queryBuilder.getMany();

    return createPaginatedResponse(
      coaches.map(c => this.toResponseDto(c)),
      total,
      page,
      limit
    );
  }

  async findOne(id: string): Promise<CoachResponseDto> {
    const coach = await this.coachRepository
      .createQueryBuilder('coach')
      .loadRelationCountAndMap('coach.documentCount', 'coach.documents')
      .where('coach.id = :id', { id })
      .getOne();

    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    return this.toResponseDto(coach);
  }

  async update(id: string, updateDto: UpdateCoachDto): Promise<CoachResponseDto> {
    const coach = await this.coachRepository.findOne({ where: { id } });

    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    Object.assign(coach, updateDto);
    const saved = await this.coachRepository.save(coach);
    return this.toResponseDto(saved);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const coach = await this.coachRepository.findOne({ where: { id } });

    if (!coach) {
      throw new NotFoundException(`Coach with ID "${id}" not found`);
    }

    await this.coachRepository.remove(coach);
    return { success: true, message: `Coach "${coach.name}" deleted successfully` };
  }

  async count(): Promise<number> {
    return this.coachRepository.count();
  }

  async getVerifiedCoaches(): Promise<CoachResponseDto[]> {
    const coaches = await this.coachRepository.find({
      where: { isVerified: true },
      order: { rank: 'DESC' }
    });
    return coaches.map(c => this.toResponseDto(c));
  }

  private toResponseDto(coach: Coach & { documentCount?: number }): CoachResponseDto {
    return {
      id: coach.id,
      name: coach.name,
      isVerified: coach.isVerified,
      bio: coach.bio,
      rank: coach.rank,
      createdAt: coach.createdAt,
      updatedAt: coach.updatedAt,
      documentCount: coach.documentCount
    };
  }
}
