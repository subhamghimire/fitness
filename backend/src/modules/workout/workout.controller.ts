import { Controller, Get, Param, Query, Req, UseGuards, ParseUUIDPipe, DefaultValuePipe, ParseIntPipe } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { WorkoutService } from "./workout.service";
import { WorkoutHistoryQueryDto, ExerciseHistoryQueryDto } from "./dto/workout.dto";
import { WorkoutDetailResponseDto, PaginatedWorkoutSummaryResponseDto, PaginatedWorkoutDetailResponseDto, PaginatedExerciseHistoryResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

type AuthedRequest = Request & { user: { id: string } };

@ApiTags("Workouts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("workouts")
export class WorkoutController {
  constructor(private readonly workoutService: WorkoutService) {}

  @Get()
  @ApiOperation({ summary: "Get workout history (paginated)" })
  @ApiResponse({ status: 200, description: "Paginated history", type: PaginatedWorkoutSummaryResponseDto })
  history(@Req() req: AuthedRequest, @Query() query: WorkoutHistoryQueryDto): Promise<PaginatedWorkoutSummaryResponseDto> {
    return this.workoutService.getHistory(req.user.id, query);
  }

  @Get("recent")
  @ApiOperation({ summary: "Get recent workouts" })
  @ApiResponse({ status: 200, description: "Recent workouts" })
  recent(@Req() req: AuthedRequest, @Query("limit", new DefaultValuePipe(5), ParseIntPipe) limit = 5): Promise<unknown> {
    return this.workoutService.getRecentWorkouts(req.user.id, limit);
  }

  @Get("exercise/:exerciseId/history")
  @ApiOperation({ summary: "Paginated history for one exercise across workouts" })
  @ApiParam({ name: "exerciseId" })
  @ApiResponse({ status: 200, description: "Paginated exercise history", type: PaginatedExerciseHistoryResponseDto })
  exerciseHistory(
    @Req() req: AuthedRequest,
    @Param("exerciseId", ParseUUIDPipe) exerciseId: string,
    @Query() query: ExerciseHistoryQueryDto
  ): Promise<PaginatedExerciseHistoryResponseDto> {
    return this.workoutService.getExerciseHistory(req.user.id, exerciseId, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single workout with exercises and sets" })
  @ApiParam({ name: "id" })
  @ApiResponse({ status: 200, description: "Workout detail", type: PaginatedWorkoutDetailResponseDto })
  @ApiResponse({ status: 404, description: "Not found" })
  detail(@Req() req: AuthedRequest, @Param("id", ParseUUIDPipe) id: string): Promise<WorkoutDetailResponseDto> {
    return this.workoutService.getDetail(req.user.id, id);
  }
}
