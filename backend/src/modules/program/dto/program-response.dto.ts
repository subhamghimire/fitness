import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProgramAssignmentStatus } from "../enums/program.enum";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";

export class ProgramWorkoutResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: "Referenced WorkoutTemplate" })
  workoutTemplateId: string;

  @ApiPropertyOptional()
  name: string | null;

  @ApiProperty()
  orderIndex: number;

  @ApiPropertyOptional()
  notes: string | null;
}

export class ProgramDayResponseDto {
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

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty({ type: [ProgramWorkoutResponseDto] })
  workouts: ProgramWorkoutResponseDto[];
}

export class ProgramResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [ProgramDayResponseDto] })
  days: ProgramDayResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ClientBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class PaginatedProgramResponseDto extends PaginatedResponseDto<ProgramResponseDto> {
  @ApiProperty({ type: [ProgramResponseDto] })
  declare data: ProgramResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class ProgramAssignmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  programId: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  clientId: string;

  @ApiProperty({ type: ProgramResponseDto })
  program: ProgramResponseDto;

  @ApiProperty({ type: ClientBriefDto })
  client: ClientBriefDto;

  @ApiProperty()
  startDate: Date;

  @ApiPropertyOptional()
  endDate: Date | null;

  @ApiProperty({ enum: ProgramAssignmentStatus })
  status: ProgramAssignmentStatus;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  startedAt: Date | null;

  @ApiPropertyOptional()
  endedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
