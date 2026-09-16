import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { Exercise } from "./entities/exercise.entity";
import { FilesService } from "../files/files.service";
import { createPaginatedResponse } from "src/common/dto";
import { CreateExerciseDto, UpdateExerciseDto, ExerciseQueryDto, PaginatedExerciseResponseDto, ExerciseResponseDto } from "./dto";
import { ConfigService } from "@nestjs/config";
import { isUUID } from "class-validator";

@Injectable()
export class ExerciseService {
  constructor(
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService
  ) {}

  async create(createExerciseDto: CreateExerciseDto): Promise<ExerciseResponseDto> {
    const existing = await this.exerciseRepository.findOne({
      where: { slug: createExerciseDto.slug }
    });

    if (existing) {
      throw new ConflictException(`Exercise with slug "${createExerciseDto.slug}" already exists`);
    }

    const { imageIds, ...exerciseData } = createExerciseDto;

    // Create exercise instance
    const exercise = this.exerciseRepository.create(exerciseData);

    // Process images if provided
    if (imageIds && imageIds.length > 0) {
      const files = await this.filesService.getFiles(imageIds);

      // Map file entities to paths or URLs
      exercise.images = files;
    }

    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async findAll(query: ExerciseQueryDto): Promise<PaginatedExerciseResponseDto> {
    const { search, page, limit, sortBy = "title", sortOrder = "ASC" } = query;

    const queryBuilder = this.exerciseRepository.createQueryBuilder("exercise").leftJoinAndSelect("exercise.images", "files");

    if (search) {
      queryBuilder.where("(exercise.title ILIKE :search OR exercise.description ILIKE :search)", { search: `%${search}%` });
    }

    const validSortColumns = ["title", "createdAt", "updatedAt"];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : "title";
    queryBuilder.orderBy(`exercise.${sortColumn}`, sortOrder === "DESC" ? "DESC" : "ASC");

    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [exercises, total] = await queryBuilder.getManyAndCount();
    return createPaginatedResponse(
      exercises.map((e) => this.toResponseDto(e)),
      total,
      page,
      limit
    );
  }

  async findOne(id_slug: string): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({
      where: isUUID(id_slug) ? { id: id_slug } : { slug: id_slug },
      relations: { images: true }
    });

    if (!exercise) {
      throw new NotFoundException(`Exercise with ID or slug "${id_slug}" not found`);
    }

    return this.toResponseDto(exercise);
  }

  async update(id: string, updateExerciseDto: UpdateExerciseDto): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({
      where: { id }
    });

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

    const { imageIds, ...updateData } = updateExerciseDto;

    // Update basic fields
    Object.assign(exercise, updateData);

    // Process images if provided
    if (imageIds && imageIds.length > 0) {
      const files = await this.filesService.getFiles(imageIds);

      // Map file entities to paths or URLs
      exercise.images = files;
    }
    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async enableDisable(id: string): Promise<ExerciseResponseDto> {
    const exercise = await this.exerciseRepository.findOne({ where: { id } });

    if (!exercise) {
      throw new NotFoundException("Exercise not found");
    }

    if (exercise.isDeleted) {
      exercise.isDeleted = false;
      exercise.deletedAt = null;
      exercise.deletedBy = null;
    } else {
      exercise.isDeleted = true;
      exercise.deletedAt = new Date();
      // exercise.deletedBy = userId;
    }

    const saved = await this.exerciseRepository.save(exercise);
    return this.toResponseDto(saved);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const exercise = await this.exerciseRepository.findOne({ where: { id, isDeleted: true } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with ID "${id}" not found`);
    }

    await this.exerciseRepository.remove(exercise);
    return { success: true, message: `Exercise "${exercise.title}" deleted successfully` };
  }

  /**
   * Find an exercise catalog entry by title or create a "custom exercise"
   * owned by nobody but usable by any user (mirrors what the sync pipeline
   * does for exercises it can't resolve). Runs inside a caller-owned
   * transaction so offline push + catalog creation commit atomically.
   *
   * Retries with a numeric suffix when the derived slug collides (unique
   * constraint on `exercises.slug`), so concurrent custom-exercise creates
   * never 500 on the driver's duplicate-key error.
   */
  async findOrCreateCustomExercise(manager: EntityManager, title: string): Promise<Exercise> {
    const trimmed = title.trim();
    const existing = await manager.findOne(Exercise, { where: { title: trimmed, isDeleted: false } });
    if (existing) return existing;

    const baseSlug = this.slugify(trimmed) || "custom-exercise";
    for (let attempt = 1; attempt <= 20; attempt++) {
      const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
      try {
        const entity = this.exerciseRepository.create({
          title: trimmed,
          slug,
          description: "Custom exercise created from app"
        });
        return await manager.save(Exercise, entity);
      } catch (error: unknown) {
        // unique_violation on slug
        const pgError = error as { driverError?: { code?: string } };
        if (pgError?.driverError?.code === "23505" && attempt < 20) continue;
        throw error;
      }
    }
    throw new ConflictException("Unable to create custom exercise: slug collision");
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 255);
  }

  private toResponseDto(exercise: Exercise): ExerciseResponseDto {
    return {
      ...exercise,
      images: exercise.images ? exercise.images.map((file) => `${this.configService.get<string>("APP_URL")}/${file.path}`) : []
    };
  }
}
