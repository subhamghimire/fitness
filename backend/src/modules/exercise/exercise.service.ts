import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';
import { createPaginatedResponse } from 'src/common/dto';
import {
  CreateExerciseDto,
  UpdateExerciseDto,
  ExerciseQueryDto,
  PaginatedExerciseResponseDto,
  ExerciseResponseDto
} from './dto';

@Injectable()
export class ExerciseService {
  constructor(
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>
  ) {}

  async create(createExerciseDto: CreateExerciseDto): Promise<ExerciseResponseDto> {
    const existing = await this.exerciseRepository.findOne({
      where: { slug: createExerciseDto.slug }
    });
    
    if (existing) {
      throw new ConflictException(`Exercise with slug "${createExerciseDto.slug}" already exists`);
    }

    const exercise = this.exerciseRepository.create(createExerciseDto);
    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async findAll(query: ExerciseQueryDto): Promise<PaginatedExerciseResponseDto> {
    const { search, page = 1, limit = 20, sortBy = 'title', sortOrder = 'ASC' } = query;

    const queryBuilder = this.exerciseRepository.createQueryBuilder('exercise');

    if (search) {
      queryBuilder.where(
        '(exercise.title ILIKE :search OR exercise.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const validSortColumns = ['title', 'createdAt', 'updatedAt'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'title';
    queryBuilder.orderBy(`exercise.${sortColumn}`, sortOrder === 'DESC' ? 'DESC' : 'ASC');

    const total = await queryBuilder.getCount();
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const exercises = await queryBuilder.getMany();

    return createPaginatedResponse(
      exercises.map(e => this.toResponseDto(e)),
      total,
      page,
      limit
    );
  }

  async findOne(id: string): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }
    return this.toResponseDto(exercise);
  }

  async findBySlug(slug: string): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { slug } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with slug "${slug}" not found`);
    }
    return this.toResponseDto(exercise);
  }

  async update(id: string, updateExerciseDto: UpdateExerciseDto): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }

    if (updateExerciseDto.slug && updateExerciseDto.slug !== exercise.slug) {
      const existing = await this.exerciseRepository.findOne({
        where: { slug: updateExerciseDto.slug }
      });
      if (existing) {
        throw new ConflictException(`Exercise with slug "${updateExerciseDto.slug}" already exists`);
      }
    }

    Object.assign(exercise, updateExerciseDto);
    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async addImages(id: string, imageUrls: string[]): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }

    exercise.images = [...(exercise.images || []), ...imageUrls];
    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async removeImage(id: string, imageUrl: string): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }

    exercise.images = (exercise.images || []).filter(img => img !== imageUrl);
    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }

    await this.exerciseRepository.remove(exercise);
    return { success: true, message: `Exercise "${exercise.title}" deleted successfully` };
  }

  async count(): Promise<number> {
    return this.exerciseRepository.count();
  }

  private toResponseDto(exercise: Exercise): ExerciseResponseDto {
    return {
      id: exercise.id,
      title: exercise.title,
      slug: exercise.slug,
      description: exercise.description,
      images: exercise.images,
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    };
  }
}
