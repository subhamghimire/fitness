import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserWorkout } from './entities/user-workout.entity';
import { createPaginatedResponse } from 'src/common/dto';
import {
  CreateUserWorkoutDto,
  UpdateUserWorkoutDto,
  UserWorkoutQueryDto,
  PaginatedUserWorkoutResponseDto,
  UserWorkoutResponseDto
} from './dto';

@Injectable()
export class UserWorkoutService {
  constructor(
    @InjectRepository(UserWorkout)
    private readonly userWorkoutRepository: Repository<UserWorkout>
  ) {}

  async create(userId: string, createDto: CreateUserWorkoutDto): Promise<UserWorkoutResponseDto> {
    // Check if user already has this exercise saved
    const existing = await this.userWorkoutRepository.findOne({
      where: { userId, exerciseId: createDto.exerciseId }
    });

    if (existing) {
      throw new ConflictException('Exercise already added to your workouts');
    }

    const userWorkout = this.userWorkoutRepository.create({
      userId,
      ...createDto
    });

    const saved = await this.userWorkoutRepository.save(userWorkout);
    return this.toResponseDto(saved);
  }

  async findAll(userId: string, query: UserWorkoutQueryDto): Promise<PaginatedUserWorkoutResponseDto> {
    const { exerciseId, page = 1, limit = 20, sortOrder = 'DESC' } = query;

    const queryBuilder = this.userWorkoutRepository
      .createQueryBuilder('userWorkout')
      .leftJoinAndSelect('userWorkout.exercise', 'exercise')
      .where('userWorkout.userId = :userId', { userId });

    if (exerciseId) {
      queryBuilder.andWhere('userWorkout.exerciseId = :exerciseId', { exerciseId });
    }

    queryBuilder.orderBy('userWorkout.createdAt', sortOrder === 'ASC' ? 'ASC' : 'DESC');

    const total = await queryBuilder.getCount();
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const userWorkouts = await queryBuilder.getMany();

    return createPaginatedResponse(
      userWorkouts.map(uw => this.toResponseDto(uw)),
      total,
      page,
      limit
    );
  }

  async findOne(userId: string, id: string): Promise<UserWorkoutResponseDto> {
    const userWorkout = await this.userWorkoutRepository.findOne({
      where: { id, userId },
      relations: ['exercise']
    });

    if (!userWorkout) {
      throw new NotFoundException(`User workout not found`);
    }

    return this.toResponseDto(userWorkout);
  }

  async update(userId: string, id: string, updateDto: UpdateUserWorkoutDto): Promise<UserWorkoutResponseDto> {
    const userWorkout = await this.userWorkoutRepository.findOne({
      where: { id, userId }
    });

    if (!userWorkout) {
      throw new NotFoundException(`User workout not found`);
    }

    Object.assign(userWorkout, updateDto);
    const saved = await this.userWorkoutRepository.save(userWorkout);
    return this.toResponseDto(saved);
  }

  async remove(userId: string, id: string): Promise<{ success: boolean; message: string }> {
    const userWorkout = await this.userWorkoutRepository.findOne({
      where: { id, userId }
    });

    if (!userWorkout) {
      throw new NotFoundException(`User workout not found`);
    }

    await this.userWorkoutRepository.remove(userWorkout);
    return { success: true, message: 'Exercise removed from your workouts' };
  }

  async count(userId: string): Promise<number> {
    return this.userWorkoutRepository.count({ where: { userId } });
  }

  private toResponseDto(userWorkout: UserWorkout): UserWorkoutResponseDto {
    const response: UserWorkoutResponseDto = {
      id: userWorkout.id,
      userId: userWorkout.userId,
      exerciseId: userWorkout.exerciseId,
      notes: userWorkout.notes,
      createdAt: userWorkout.createdAt,
      updatedAt: userWorkout.updatedAt
    };

    if (userWorkout.exercise) {
      response.exercise = {
        id: userWorkout.exercise.id,
        title: userWorkout.exercise.title,
        slug: userWorkout.exercise.slug
      };
    }

    return response;
  }
}
