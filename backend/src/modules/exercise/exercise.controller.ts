import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { ExerciseService } from "./exercise.service";
import { CreateExerciseDto, UpdateExerciseDto, ExerciseQueryDto, PaginatedExerciseResponseDto, ExerciseResponseDto } from "./dto";

@ApiTags("Exercises")
@Controller("exercises")
export class ExerciseController {
  constructor(private readonly exerciseService: ExerciseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a new exercise" })
  @ApiResponse({ status: 201, description: "Exercise created", type: ExerciseResponseDto })
  @ApiResponse({ status: 409, description: "Slug already exists" })
  create(@Body() createExerciseDto: CreateExerciseDto): Promise<ExerciseResponseDto> {
    return this.exerciseService.create(createExerciseDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all exercises with pagination" })
  @ApiResponse({ status: 200, description: "Paginated exercises", type: PaginatedExerciseResponseDto })
  findAll(@Query() query: ExerciseQueryDto): Promise<PaginatedExerciseResponseDto> {
    return this.exerciseService.findAll(query);
  }

  @Get(":id_slug")
  @ApiOperation({ summary: "Get exercise by ID or slug" })
  @ApiParam({ name: "id_slug", description: "Exercise UUID or slug" })
  @ApiResponse({ status: 200, description: "Exercise found", type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: "Exercise not found" })
  findOne(@Param("id_slug") id_slug: string): Promise<ExerciseResponseDto> {
    return this.exerciseService.findOne(id_slug);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an exercise" })
  @ApiParam({ name: "id", description: "Exercise UUID" })
  @ApiResponse({ status: 200, description: "Exercise updated", type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: "Exercise not found" })
  update(@Param("id", ParseUUIDPipe) id: string, @Body() updateExerciseDto: UpdateExerciseDto): Promise<ExerciseResponseDto> {
    return this.exerciseService.update(id, updateExerciseDto);
  }

  @Patch(":id/enable_disable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Enable or disable an exercise" })
  @ApiParam({ name: "id", description: "Exercise UUID" })
  @ApiResponse({ status: 200, description: "Exercise status updated", type: ExerciseResponseDto })
  @ApiResponse({ status: 404, description: "Exercise not found" })
  enableDisable(@Param("id", ParseUUIDPipe) id: string): Promise<ExerciseResponseDto> {
    return this.exerciseService.enableDisable(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete an exercise" })
  @ApiParam({ name: "id", description: "Exercise UUID" })
  @ApiResponse({ status: 200, description: "Exercise deleted" })
  @ApiResponse({ status: 404, description: "Exercise not found" })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.exerciseService.remove(id);
  }
}
