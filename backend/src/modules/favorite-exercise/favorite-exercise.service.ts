import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FavoriteExercise } from "./entities/favorite-exercise.entity";
import { createPaginatedResponse } from "src/common/dto";
import { CreateFavoriteExerciseDto, UpdateFavoriteExerciseDto, FavoriteExerciseQueryDto, PaginatedFavoriteExerciseResponseDto, FavoriteExerciseResponseDto } from "./dto";

@Injectable()
export class FavoriteExerciseService {
  constructor(
    @InjectRepository(FavoriteExercise)
    private readonly favoriteExerciseRepository: Repository<FavoriteExercise>
  ) {}

  async create(userId: string, createDto: CreateFavoriteExerciseDto): Promise<FavoriteExerciseResponseDto> {
    const existing = await this.favoriteExerciseRepository.findOne({
      where: { userId, exerciseId: createDto.exerciseId }
    });

    if (existing) {
      throw new ConflictException("Exercise already added to your workouts");
    }

    const favoriteExercise = this.favoriteExerciseRepository.create({
      userId,
      ...createDto
    });

    const saved = await this.favoriteExerciseRepository.save(favoriteExercise);
    return this.toResponseDto(saved);
  }

  async findAll(userId: string, query: FavoriteExerciseQueryDto): Promise<PaginatedFavoriteExerciseResponseDto> {
    const { exerciseId, page = 1, limit = 20, sortOrder = "DESC" } = query;

    const queryBuilder = this.favoriteExerciseRepository
      .createQueryBuilder("favoriteExercise")
      .leftJoinAndSelect("favoriteExercise.exercise", "exercise")
      .where("favoriteExercise.userId = :userId", { userId });

    if (exerciseId) {
      queryBuilder.andWhere("favoriteExercise.exerciseId = :exerciseId", { exerciseId });
    }

    queryBuilder.orderBy("favoriteExercise.createdAt", sortOrder === "ASC" ? "ASC" : "DESC");

    const total = await queryBuilder.getCount();
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const favoriteExercises = await queryBuilder.getMany();

    return createPaginatedResponse(
      favoriteExercises.map((fe) => this.toResponseDto(fe)),
      total,
      page,
      limit
    );
  }

  async findOne(userId: string, id: string): Promise<FavoriteExerciseResponseDto> {
    const favoriteExercise = await this.favoriteExerciseRepository.findOne({
      where: { id, userId },
      relations: ["exercise"]
    });

    if (!favoriteExercise) {
      throw new NotFoundException(`Favorite exercise not found`);
    }

    return this.toResponseDto(favoriteExercise);
  }

  async update(userId: string, id: string, updateDto: UpdateFavoriteExerciseDto): Promise<FavoriteExerciseResponseDto> {
    const favoriteExercise = await this.favoriteExerciseRepository.findOne({
      where: { id, userId }
    });

    if (!favoriteExercise) {
      throw new NotFoundException(`Favorite exercise not found`);
    }

    Object.assign(favoriteExercise, updateDto);
    const saved = await this.favoriteExerciseRepository.save(favoriteExercise);
    return this.toResponseDto(saved);
  }

  async remove(userId: string, id: string): Promise<{ success: boolean; message: string }> {
    const favoriteExercise = await this.favoriteExerciseRepository.findOne({
      where: { id, userId }
    });

    if (!favoriteExercise) {
      throw new NotFoundException(`Favorite exercise not found`);
    }

    await this.favoriteExerciseRepository.remove(favoriteExercise);
    return { success: true, message: "Exercise removed from your workouts" };
  }

  async count(userId: string): Promise<number> {
    return this.favoriteExerciseRepository.count({ where: { userId } });
  }

  private toResponseDto(favoriteExercise: FavoriteExercise): FavoriteExerciseResponseDto {
    const response: FavoriteExerciseResponseDto = {
      id: favoriteExercise.id,
      userId: favoriteExercise.userId,
      exerciseId: favoriteExercise.exerciseId,
      notes: favoriteExercise.notes,
      createdAt: favoriteExercise.createdAt,
      updatedAt: favoriteExercise.updatedAt
    };

    if (favoriteExercise.exercise) {
      response.exercise = {
        id: favoriteExercise.exercise.id,
        title: favoriteExercise.exercise.title,
        slug: favoriteExercise.exercise.slug
      };
    }

    return response;
  }
}
