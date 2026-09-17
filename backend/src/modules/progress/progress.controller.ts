import { Controller, Get, Param, Query, Req, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ProgressService } from "./progress.service";
import { OverviewQueryDto, ExerciseListQueryDto, ExerciseHistoryQueryDto, PersonalRecordsQueryDto, VolumeHistoryQueryDto, WorkoutFrequencyQueryDto } from "./dto";
import {
  ProgressOverviewResponseDto,
  PaginatedExerciseStatResponseDto,
  PaginatedExerciseHistoryResponseDto,
  PaginatedPersonalRecordResponseDto,
  VolumeHistoryEntryDto,
  WorkoutFrequencyEntryDto
} from "./dto";

type AuthedRequest = Request & { user: { id: string } };

/**
 * PROGRESS / STATISTICS API
 *
 * All endpoints read from the materialized projection tables (see
 * ProgressService). None of them scans historical workout sets, so they stay
 * cheap no matter how large the workout history grows.
 */
@ApiTags("Progress")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("progress")
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get("overview")
  @ApiOperation({ summary: "Progress dashboard overview (totals + weekly frequency)" })
  @ApiResponse({ status: 200, description: "Dashboard overview", type: ProgressOverviewResponseDto })
  overview(@Req() req: AuthedRequest, @Query() query: OverviewQueryDto): Promise<ProgressOverviewResponseDto> {
    return this.progressService.overview(req.user.id, query);
  }

  @Get("exercises")
  @ApiOperation({ summary: "Per-exercise rollups (bests, volume, progression) paginated" })
  @ApiResponse({ status: 200, description: "Paginated exercise statistics", type: PaginatedExerciseStatResponseDto })
  exercises(@Req() req: AuthedRequest, @Query() query: ExerciseListQueryDto): Promise<PaginatedExerciseStatResponseDto> {
    return this.progressService.listExercises(req.user.id, query);
  }

  @Get("exercises/:exerciseId/history")
  @ApiOperation({ summary: "Exercise progression history (session-by-session) paginated" })
  @ApiParam({ name: "exerciseId" })
  @ApiResponse({ status: 200, description: "Paginated exercise history", type: PaginatedExerciseHistoryResponseDto })
  exerciseHistory(
    @Req() req: AuthedRequest,
    @Param("exerciseId", ParseUUIDPipe) exerciseId: string,
    @Query() query: ExerciseHistoryQueryDto
  ): Promise<PaginatedExerciseHistoryResponseDto> {
    return this.progressService.exerciseHistory(req.user.id, exerciseId, query);
  }

  @Get("prs")
  @ApiOperation({ summary: "Personal record list (PR detection chain) paginated" })
  @ApiResponse({ status: 200, description: "Paginated personal records", type: PaginatedPersonalRecordResponseDto })
  personalRecords(@Req() req: AuthedRequest, @Query() query: PersonalRecordsQueryDto): Promise<PaginatedPersonalRecordResponseDto> {
    return this.progressService.listPersonalRecords(req.user.id, query);
  }

  @Get("volume-history")
  @ApiOperation({ summary: "Training volume time series (day/week/month buckets)" })
  @ApiResponse({ status: 200, description: "Volume history buckets", type: [VolumeHistoryEntryDto] })
  volumeHistory(@Req() req: AuthedRequest, @Query() query: VolumeHistoryQueryDto): Promise<VolumeHistoryEntryDto[]> {
    return this.progressService.volumeHistory(req.user.id, query);
  }

  @Get("workout-frequency")
  @ApiOperation({ summary: "Workout frequency time series (day/week/month buckets)" })
  @ApiResponse({ status: 200, description: "Frequency buckets", type: [WorkoutFrequencyEntryDto] })
  workoutFrequency(@Req() req: AuthedRequest, @Query() query: WorkoutFrequencyQueryDto): Promise<WorkoutFrequencyEntryDto[]> {
    return this.progressService.workoutFrequency(req.user.id, query);
  }
}
