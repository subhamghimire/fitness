import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProgramWorkoutResponseDto } from "./program-response.dto";

export class ProgramDayProgressDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  weekNumber: number;

  @ApiProperty()
  dayNumber: number;

  @ApiProperty()
  orderIndex: number;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional({ description: "Schedule date derived from the assignment start date" })
  scheduledDate: Date | null;

  @ApiProperty({ description: "True when at least one workout was logged on the scheduled day" })
  completed: boolean;

  @ApiProperty({ type: [ProgramWorkoutResponseDto] })
  workouts: ProgramWorkoutResponseDto[];
}

export class ProgramProgressDto {
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

  @ApiProperty()
  totalWorkouts: number;

  @ApiProperty()
  completedWorkouts: number;

  @ApiProperty()
  totalDays: number;

  @ApiProperty()
  completedDays: number;

  @ApiProperty()
  percentComplete: number;

  @ApiProperty({ description: "Workouts logged by the client inside the assignment window" })
  loggedWorkoutCount: number;

  @ApiProperty({ description: "Working-set volume (kg) logged inside the assignment window" })
  volumeKg: number;

  @ApiProperty({ type: [ProgramDayProgressDto] })
  days: ProgramDayProgressDto[];
}
