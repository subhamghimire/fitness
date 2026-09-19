import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsOptional, IsUUID } from "class-validator";
import { ProgramAssignmentStatus } from "../enums/program.enum";

export class AssignProgramDto {
  @ApiProperty({ description: "Client (user) to assign the program to" })
  @IsUUID()
  clientId: string;

  @ApiProperty({ description: "First calendar day of the plan (ISO date-time)" })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiPropertyOptional({ description: "Scheduled last day of the plan" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({ enum: ProgramAssignmentStatus, description: "Defaults to upcoming" })
  @IsOptional()
  @IsEnum(ProgramAssignmentStatus)
  status?: ProgramAssignmentStatus;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional({ enum: ProgramAssignmentStatus, description: "Transitions: upcoming->active, *->completed/cancelled" })
  @IsOptional()
  @IsEnum(ProgramAssignmentStatus)
  status?: ProgramAssignmentStatus;

  @ApiPropertyOptional({ description: "Lower the end date (never before start date)" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({ description: "Undo" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;
}

export class AssignmentQueryDto {
  @ApiPropertyOptional({ description: "Filter by a specific client" })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ enum: ProgramAssignmentStatus })
  @IsOptional()
  @IsEnum(ProgramAssignmentStatus)
  status?: ProgramAssignmentStatus;

  @ApiPropertyOptional({ description: "Only live (upcoming/active) assignments" })
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;
}
