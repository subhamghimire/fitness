import { Controller, Get, Param, Query, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { ProgramAssignmentService } from "./program-assignment.service";
import { ProgramAssignmentResponseDto, ProgramProgressDto, AssignmentQueryDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

/**
 * CLIENT-facing program API. Every lookup is rooted in the client's own user id
 * (ProgramAssignmentService clientId scope); client A can never read client B's
 * assigned programs or progress.
 */
@ApiTags("Client")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("client")
export class ClientProgramController {
  constructor(private readonly assignmentService: ProgramAssignmentService) {}

  @Get("programs")
  @ApiOperation({ summary: "Client lists their own assigned programs" })
  @ApiResponse({ status: 200, type: [ProgramAssignmentResponseDto] })
  myPrograms(@CurrentUser() user: User, @Query() query: AssignmentQueryDto): Promise<ProgramAssignmentResponseDto[]> {
    return this.assignmentService.listForClient(user, query);
  }

  @Get("programs/:id")
  @ApiOperation({ summary: "Client views one of their assigned programs" })
  @ApiParam({ name: "id", description: "Assignment UUID" })
  @ApiResponse({ status: 200, type: ProgramAssignmentResponseDto })
  oneProgram(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProgramAssignmentResponseDto> {
    return this.assignmentService.findForClient(user, id);
  }

  @Get("programs/:id/progress")
  @ApiOperation({ summary: "Client views progress against their assigned program" })
  @ApiParam({ name: "id", description: "Assignment UUID" })
  @ApiResponse({ status: 200, type: ProgramProgressDto })
  programProgress(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ProgramProgressDto> {
    return this.assignmentService.progress(user, id);
  }
}
