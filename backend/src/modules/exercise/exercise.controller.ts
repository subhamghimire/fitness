import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  BadRequestException
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam
} from '@nestjs/swagger';
import { ExerciseService } from './exercise.service';
import {
  CreateExerciseDto,
  UpdateExerciseDto,
  ExerciseQueryDto,
  PaginatedExerciseResponseDto,
  ExerciseResponseDto
} from './dto';

@ApiTags('Exercises')
@Controller('exercises')
export class ExerciseController {
  constructor(
    private readonly exerciseService: ExerciseService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new exercise' })
  @ApiResponse({ status: 201, description: 'Exercise created', type: ExerciseResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  create(@Body() createExerciseDto: CreateExerciseDto): Promise<ExerciseResponseDto> {
    return this.exerciseService.create(createExerciseDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all exercises with pagination' })
  @ApiResponse({ status: 200, description: 'Paginated exercises', type: PaginatedExerciseResponseDto })
  findAll(@Query() query: ExerciseQueryDto): Promise<PaginatedExerciseResponseDto> {
    return this.exerciseService.findAll(query);
  }

  @Get('count')
  @ApiOperation({ summary: 'Get total exercise count' })
  @ApiResponse({ status: 200, description: 'Total count', type: Number })
  count(): Promise<number> {
    return this.exerciseService.count();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get exercise by slug' })
  @ApiParam({ name: 'slug', example: 'barbell-bench-press' })
  @ApiResponse({ status: 200, description: 'Exercise found', type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: 'Exercise not found' })
  findBySlug(@Param('slug') slug: string): Promise<ExerciseResponseDto> {
    return this.exerciseService.findBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get exercise by ID' })
  @ApiParam({ name: 'id', description: 'Exercise UUID' })
  @ApiResponse({ status: 200, description: 'Exercise found', type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: 'Exercise not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ExerciseResponseDto> {
    return this.exerciseService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an exercise' })
  @ApiParam({ name: 'id', description: 'Exercise UUID' })
  @ApiResponse({ status: 200, description: 'Exercise updated', type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: 'Exercise not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateExerciseDto: UpdateExerciseDto
  ): Promise<ExerciseResponseDto> {
    return this.exerciseService.update(id, updateExerciseDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an exercise' })
  @ApiParam({ name: 'id', description: 'Exercise UUID' })
  @ApiResponse({ status: 200, description: 'Exercise deleted' })
  @ApiResponse({ status: 404, description: 'Exercise not found' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.exerciseService.remove(id);
  }
}
