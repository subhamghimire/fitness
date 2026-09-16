import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Req, UseGuards, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { WorkoutTemplateService } from "./workout-template.service";
import { CreateWorkoutTemplateDto, WorkoutTemplateResponseDto, WorkoutTemplateQueryDto, PaginatedWorkoutTemplateResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

type AuthedRequest = Request & { user: { id: string } };

@ApiTags("Workout Templates")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("workout-templates")
export class WorkoutTemplateController {
  constructor(private readonly workoutTemplateService: WorkoutTemplateService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a workout template with planned exercises and sets" })
  @ApiResponse({ status: 201, description: "Created", type: WorkoutTemplateResponseDto })
  create(@Req() req: AuthedRequest, @Body() dto: CreateWorkoutTemplateDto): Promise<WorkoutTemplateResponseDto> {
    return this.workoutTemplateService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List workout templates (paginated)" })
  @ApiResponse({ status: 200, description: "Paginated templates", type: PaginatedWorkoutTemplateResponseDto })
  list(@Req() req: AuthedRequest, @Query() query: WorkoutTemplateQueryDto): Promise<PaginatedWorkoutTemplateResponseDto> {
    return this.workoutTemplateService.list(req.user.id, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a workout template with exercises and sets" })
  @ApiParam({ name: "id" })
  @ApiResponse({ status: 200, description: "Template detail", type: WorkoutTemplateResponseDto })
  @ApiResponse({ status: 404, description: "Not found" })
  detail(@Req() req: AuthedRequest, @Param("id", ParseUUIDPipe) id: string): Promise<WorkoutTemplateResponseDto> {
    return this.workoutTemplateService.getDetail(req.user.id, id);
  }
}
