import { Controller, Get, Post, Body, Patch, Delete, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { ProgramService } from "./program.service";
import { ProgramAssignmentService } from "./program-assignment.service";
import {
  CreateProgramDto,
  UpdateProgramDto,
  ProgramQueryDto,
  PaginatedProgramResponseDto,
  ProgramResponseDto,
  AssignProgramDto,
  UpdateAssignmentDto,
  AssignmentQueryDto,
  ProgramAssignmentResponseDto,
  ProgramProgressDto
} from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

/**
 * PROGRAM API (coach-facing)
 *
 * - Program CRUD is strictly coach-owned (ProgramService verifies coachId).
 * - Assignments require an ACTIVE coach-client relationship and are scoped to
 *   the acting coach; clients can only read their own (see ClientProgramController).
 */
@ApiTags("Programs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("programs")
export class ProgramController {
  constructor(
    private readonly programService: ProgramService,
    private readonly assignmentService: ProgramAssignmentService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a program (with optional days/workouts)" })
  @ApiResponse({ status: 201, type: ProgramResponseDto })
  create(@CurrentUser() user: User, @Body() dto: CreateProgramDto): Promise<ProgramResponseDto> {
    return this.programService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the coach's own programs" })
  @ApiResponse({ status: 200, type: PaginatedProgramResponseDto })
  findAll(@CurrentUser() user: User, @Query() query: ProgramQueryDto): Promise<PaginatedProgramResponseDto> {
    return this.programService.findAllForCoach(user, query);
  }

  @Post(":programId/assignments")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Coach assigns a program to a client with an active relationship" })
  @ApiParam({ name: "programId" })
  @ApiResponse({ status: 201, type: ProgramAssignmentResponseDto })
  assign(@CurrentUser() user: User, @Param("programId", ParseUUIDPipe) programId: string, @Body() dto: AssignProgramDto): Promise<ProgramAssignmentResponseDto> {
    return this.assignmentService.assign(user, programId, dto);
  }

  @Get("assignments")
  @ApiOperation({ summary: "Coach lists their own assignments (optionally filtered)" })
  @ApiResponse({ status: 200, type: [ProgramAssignmentResponseDto] })
  listAssignments(@CurrentUser() user: User, @Query() query: AssignmentQueryDto): Promise<ProgramAssignmentResponseDto[]> {
    return this.assignmentService.listForCoach(user, query);
  }

  @Get("assignments/:id/progress")
  @ApiOperation({ summary: "Assignment progress (assigned coach or assigned client)" })
  @ApiParam({ name: "id", description: "Assignment UUID" })
  @ApiResponse({ status: 200, type: ProgramProgressDto })
  assignmentProgress(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProgramProgressDto> {
    return this.assignmentService.progress(user, id);
  }

  @Get("assignments/:id")
  @ApiOperation({ summary: "Get an assignment (assigned coach or assigned client)" })
  @ApiParam({ name: "id", description: "Assignment UUID" })
  @ApiResponse({ status: 200, type: ProgramAssignmentResponseDto })
  getAssignment(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProgramAssignmentResponseDto> {
    return this.assignmentService.findForActor(user, id);
  }

  @Patch("assignments/:id")
  @ApiOperation({ summary: "Coach manages an assignment (start / complete / cancel / resize)" })
  @ApiParam({ name: "id", description: "Assignment UUID" })
  @ApiResponse({ status: 200, type: ProgramAssignmentResponseDto })
  manageAssignment(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAssignmentDto): Promise<ProgramAssignmentResponseDto> {
    return this.assignmentService.manage(user, id, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a coach's own program" })
  @ApiParam({ name: "id", description: "Program UUID" })
  @ApiResponse({ status: 200, type: ProgramResponseDto })
  findOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProgramResponseDto> {
    return this.programService.findOneForCoach(user, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a coach's own program" })
  @ApiParam({ name: "id", description: "Program UUID" })
  @ApiResponse({ status: 200, type: ProgramResponseDto })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateProgramDto): Promise<ProgramResponseDto> {
    return this.programService.update(user, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Soft-delete a coach's own program" })
  @ApiParam({ name: "id", description: "Program UUID" })
  @ApiResponse({ status: 200, type: Object })
  remove(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.programService.remove(user, id);
  }
}
