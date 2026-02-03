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
import { FileUploadService, UploadedFile } from 'src/common/services';
import 'multer';

@ApiTags('Exercises')
@Controller('exercises')
export class ExerciseController {
  constructor(
    private readonly exerciseService: ExerciseService,
    private readonly fileUploadService: FileUploadService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new exercise' })
  @ApiResponse({ status: 201, description: 'Exercise created', type: ExerciseResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  create(@Body() createExerciseDto: CreateExerciseDto): Promise<ExerciseResponseDto> {
    return this.exerciseService.create(createExerciseDto);
  }

  @Post(':id/images')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('images', 10))
  @ApiOperation({ summary: 'Upload images for an exercise' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Exercise UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' }
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Images uploaded', type: ExerciseResponseDto })
  async uploadImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[]
  ): Promise<ExerciseResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const uploadedFiles: UploadedFile[] = files.map(f => ({
      fieldname: f.fieldname,
      originalname: f.originalname,
      encoding: f.encoding,
      mimetype: f.mimetype,
      buffer: f.buffer,
      size: f.size
    }));

    const urls = await this.fileUploadService.uploadFiles(uploadedFiles, 'exercises');
    return this.exerciseService.addImages(id, urls);
  }

  @Delete(':id/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an image from exercise' })
  @ApiParam({ name: 'id', description: 'Exercise UUID' })
  @ApiBody({ schema: { type: 'object', properties: { imageUrl: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Image removed', type: ExerciseResponseDto })
  async removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('imageUrl') imageUrl: string
  ): Promise<ExerciseResponseDto> {
    await this.fileUploadService.deleteFile(imageUrl);
    return this.exerciseService.removeImage(id, imageUrl);
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
