import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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
    const { search, page = 1, limit = 20, sortBy = "title", sortOrder = "ASC" } = query;

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

  private toResponseDto(exercise: Exercise): ExerciseResponseDto {
    return {
      id: exercise.id,
      title: exercise.title,
      slug: exercise.slug,
      description: exercise.description,
      images: exercise.images ? exercise.images.map((file) => `${this.configService.get<string>("APP_URL")}/${file.path}`) : [],
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    };
  }
}
