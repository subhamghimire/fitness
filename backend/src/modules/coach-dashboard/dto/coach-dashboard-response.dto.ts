import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto } from "src/common/dto";
import { RelationshipStatus } from "src/modules/coach-client/enums";
import { ProgramAssignmentStatus } from "src/modules/program/enums/program.enum";
import { PersonalRecordResponseDto, ProgressOverviewResponseDto, WorkoutFrequencyEntryDto } from "src/modules/progress/dto/progress-response.dto";
import { PersonalRecordType } from "src/modules/progress/enums/progress.enum";

export class ClientDashboardBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class PendingRequestDto {
  @ApiProperty({ description: "Relationship id of the pending invitation" })
  relationshipId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: ClientDashboardBriefDto })
  client: ClientDashboardBriefDto;
}

export class RelationshipBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RelationshipStatus })
  status: RelationshipStatus;

  @ApiPropertyOptional()
  startedAt: Date | null;
}

export class WorkoutAdherenceDto {
  @ApiProperty({ description: "Training days actually completed in the trailing window" })
  completedTrainingDays: number;

  @ApiProperty({
    description: "Training days expected in the window: program schedule days when an active program is assigned, otherwise the window length itself"
  })
  expectedTrainingDays: number;

  @ApiPropertyOptional({ description: "0..1 ratio; null when nothing is expected yet" })
  adherence: number | null;

  @ApiProperty()
  windowDays: number;
}

export class ProgramProgressSummaryDto {
  @ApiProperty()
  assignmentId: string;

  @ApiProperty()
  programId: string;

  @ApiProperty()
  programName: string;

  @ApiProperty()
  clientId: string;

  @ApiProperty()
  startDate: Date;

  @ApiPropertyOptional()
  endDate: Date | null;

  @ApiProperty({ enum: ProgramAssignmentStatus })
  status: ProgramAssignmentStatus;

  @ApiProperty({ description: "Workout slots planned across the entire plan" })
  totalPlannedWorkouts: number;

  @ApiProperty({ description: "Planned workout slots due inside the trailing window (scheduled date <= today)" })
  scheduledWorkouts: number;

  @ApiProperty({ description: "Due workout slots completed inside the trailing window" })
  completedWorkouts: number;

  @ApiProperty({ description: "completedWorkouts / scheduledWorkouts * 100 (0 when nothing is due yet)" })
  percentComplete: number;

  @ApiProperty({ description: "Due workout slots that were not logged (only counted for active assignments)" })
  missedWorkouts: number;

  @ApiProperty({ description: "Workouts logged by the client inside the trailing window" })
  loggedWorkoutCount: number;

  @ApiProperty({ description: "Working-set volume (kg) logged by the client inside the trailing window" })
  volumeKg: number;
}

export class MissedWorkoutDto {
  @ApiProperty({ description: "Assignment the missed slot belongs to" })
  assignmentId: string;

  @ApiProperty()
  programId: string;

  @ApiProperty()
  programName: string;

  @ApiProperty({ description: "Program day that was scheduled" })
  dayId: string;

  @ApiProperty()
  weekNumber: number;

  @ApiProperty()
  dayNumber: number;

  @ApiPropertyOptional()
  dayName: string | null;

  @ApiProperty()
  scheduledDate: Date;

  @ApiProperty({ description: "Program workout slot that was missed" })
  workoutId: string;

  @ApiPropertyOptional()
  workoutName: string | null;
}

/**
 * A missed program workout slot attributed to a specific client — the unit the
 * coach-facing "who is falling behind?" queue is built from.
 */
export class MissedWorkoutEntryDto extends MissedWorkoutDto {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  clientName: string;

  @ApiProperty({ description: "Whole days between the scheduled date and today (0 = due today)" })
  daysOverdue: number;
}

export class RecentWorkoutDto {
  @ApiProperty()
  workoutId: string;

  @ApiPropertyOptional()
  name: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  durationSeconds: number | null;

  @ApiProperty({ description: "Working-set volume in kg" })
  volumeKg: number;

  @ApiProperty()
  reps: number;

  @ApiProperty()
  setCount: number;

  @ApiProperty()
  exerciseCount: number;
}

export class ClientActivityEntryDto extends RecentWorkoutDto {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  clientName: string;
}

export class RecentPrDto {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  clientName: string;

  @ApiProperty({ enum: PersonalRecordType })
  prType: PersonalRecordType;

  @ApiProperty({ description: "Unit encoded by prType (kg / reps / m / s)" })
  value: number;

  @ApiPropertyOptional()
  exerciseId: string | null;

  @ApiPropertyOptional()
  exerciseName: string | null;

  @ApiProperty()
  workoutId: string;

  @ApiProperty()
  achievedAt: Date;
}

export class ProgressTrendEntryDto {
  @ApiProperty({ description: "Bucket start (UTC)" })
  bucket: Date;

  @ApiProperty()
  workoutCount: number;

  @ApiProperty({ description: "Working-set volume in kg" })
  volumeKg: number;
}

export class ExerciseSessionSnapshotDto {
  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  bestWeightKg: number | null;

  @ApiPropertyOptional({ description: "Epley 1RM estimate for the best set" })
  bestEstimated1RmKg: number | null;

  @ApiPropertyOptional()
  bestReps: number | null;

  @ApiProperty({ description: "Working-set volume in kg" })
  volumeKg: number;
}

export class ExerciseProgressionDto {
  @ApiProperty()
  exerciseId: string;

  @ApiPropertyOptional()
  exerciseName: string | null;

  @ApiPropertyOptional()
  lastPerformedAt: Date | null;

  @ApiProperty()
  workoutCount: number;

  @ApiProperty()
  totalVolumeKg: number;

  @ApiPropertyOptional()
  bestWeightKg: number | null;

  @ApiPropertyOptional({ description: "Epley 1RM estimate for the best set" })
  bestEstimated1RmKg: number | null;

  @ApiPropertyOptional()
  bestReps: number | null;

  @ApiProperty({ type: [ExerciseSessionSnapshotDto], description: "Most recent sessions for this exercise" })
  recentSessions: ExerciseSessionSnapshotDto[];
}

export class ClientProgressSummaryDto {
  @ApiProperty({ type: ClientDashboardBriefDto })
  client: ClientDashboardBriefDto;

  @ApiProperty({ type: RelationshipBriefDto })
  relationship: RelationshipBriefDto;

  @ApiPropertyOptional()
  lastWorkoutAt: Date | null;

  @ApiProperty({ description: "Workouts logged in the trailing window" })
  workoutCountInWindow: number;

  @ApiProperty({ description: "Workouts logged over the entire history" })
  totalWorkoutCount: number;

  @ApiProperty({ type: WorkoutAdherenceDto })
  workoutAdherence: WorkoutAdherenceDto;

  @ApiProperty({ description: "Missed program workout slots in the trailing window" })
  missedWorkouts: number;

  @ApiPropertyOptional({ type: ProgramProgressSummaryDto })
  programProgress: ProgramProgressSummaryDto | null;

  @ApiProperty({ description: "Personal records set in the trailing window" })
  recentPrCount: number;
}

export class ClientProgressDetailDto {
  @ApiProperty({ type: ClientDashboardBriefDto })
  client: ClientDashboardBriefDto;

  @ApiProperty({ type: RelationshipBriefDto })
  relationship: RelationshipBriefDto;

  @ApiProperty({ type: ProgressOverviewResponseDto })
  overview: ProgressOverviewResponseDto;

  @ApiProperty({ type: WorkoutAdherenceDto })
  workoutAdherence: WorkoutAdherenceDto;

  @ApiProperty({ description: "Missed program workout slots in the trailing window" })
  missedWorkouts: number;

  @ApiPropertyOptional({ type: ProgramProgressSummaryDto })
  programProgress: ProgramProgressSummaryDto | null;

  @ApiProperty({ type: [RecentWorkoutDto] })
  recentWorkouts: RecentWorkoutDto[];

  @ApiProperty({ type: [PersonalRecordResponseDto] })
  recentPersonalRecords: PersonalRecordResponseDto[];

  @ApiProperty({ type: [ProgressTrendEntryDto] })
  progressTrends: ProgressTrendEntryDto[];

  @ApiProperty({ type: [WorkoutFrequencyEntryDto] })
  weeklyFrequency: WorkoutFrequencyEntryDto[];

  @ApiProperty({ type: [ExerciseProgressionDto] })
  exerciseProgression: ExerciseProgressionDto[];

  @ApiProperty({ type: [MissedWorkoutDto] })
  missedWorkoutDetails: MissedWorkoutDto[];
}

export class ProgramProgressOverviewDto {
  @ApiProperty({ description: "Live assignments (upcoming + active) currently held" })
  activeAssignments: number;

  @ApiProperty({ description: "Due workout slots across live assignments (trailing window)" })
  scheduledWorkouts: number;

  @ApiProperty()
  completedWorkouts: number;

  @ApiProperty()
  missedWorkouts: number;

  @ApiProperty({ description: "0..100 across live assignments" })
  percentComplete: number;
}

export class CoachDashboardOverviewResponseDto {
  @ApiProperty({ description: "Live relationships with ACTIVE status" })
  activeClientCount: number;

  @ApiProperty()
  pausedClientCount: number;

  @ApiProperty()
  pendingRequestCount: number;

  @ApiProperty({ type: [ClientProgressSummaryDto] })
  activeClients: ClientProgressSummaryDto[];

  @ApiProperty({ type: [PendingRequestDto] })
  pendingRequests: PendingRequestDto[];

  @ApiProperty({ type: [ClientActivityEntryDto] })
  recentClientWorkouts: ClientActivityEntryDto[];

  @ApiPropertyOptional({ type: WorkoutAdherenceDto })
  workoutAdherence: WorkoutAdherenceDto | null;

  @ApiProperty({ type: ProgramProgressOverviewDto })
  programProgress: ProgramProgressOverviewDto;

  @ApiProperty({ type: [RecentPrDto] })
  recentPersonalRecords: RecentPrDto[];

  @ApiProperty({ type: [ProgressTrendEntryDto] })
  progressTrends: ProgressTrendEntryDto[];
}

export class PaginatedClientProgressSummaryResponseDto extends PaginatedResponseDto<ClientProgressSummaryDto> {
  @ApiProperty({ type: [ClientProgressSummaryDto] })
  declare data: ClientProgressSummaryDto[];
}

export class PaginatedClientActivityResponseDto extends PaginatedResponseDto<ClientActivityEntryDto> {
  @ApiProperty({ type: [ClientActivityEntryDto] })
  declare data: ClientActivityEntryDto[];
}

export class PaginatedPendingRequestResponseDto extends PaginatedResponseDto<PendingRequestDto> {
  @ApiProperty({ type: [PendingRequestDto] })
  declare data: PendingRequestDto[];
}

export class PaginatedMissedWorkoutResponseDto extends PaginatedResponseDto<MissedWorkoutEntryDto> {
  @ApiProperty({ type: [MissedWorkoutEntryDto] })
  declare data: MissedWorkoutEntryDto[];
}
