import { Controller, Get, Post, Body, Patch, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { CoachClientRelationshipService } from "./coach-client-relationship.service";
import { CreateInvitationDto, UpdateRelationshipStatusDto, CoachClientQueryDto, CoachClientRelationshipResponseDto, CoachClientProgressResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
import { OverviewQueryDto } from "../progress/dto/progress-query.dto";

/**
 * COACH-CLIENT RELATIONSHIPS API
 *
 * Coach flow: invite -> (view active clients / manage / assign / view progress).
 * Client flow: accept / reject an invitation -> view coach.
 *
 * Every handler resolves the actor from the JWT and verifies relationship
 * ownership inside CoachClientRelationshipService — coach A can never reach
 * coach B's clients, and client A can never read client B's relationships.
 */
@ApiTags("Coach Clients")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("coach-clients")
export class CoachClientRelationshipController {
  constructor(private readonly service: CoachClientRelationshipService) {}

  @Post("invitations")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Coach invites a client" })
  @ApiResponse({ status: 201, type: CoachClientRelationshipResponseDto })
  invite(@CurrentUser() user: User, @Body() dto: CreateInvitationDto): Promise<CoachClientRelationshipResponseDto> {
    return this.service.invite(user, dto);
  }

  @Get()
  @ApiOperation({ summary: "Coach lists their own relationships (optionally by status)" })
  @ApiResponse({ status: 200, type: [CoachClientRelationshipResponseDto] })
  findAll(@CurrentUser() user: User, @Query() query: CoachClientQueryDto): Promise<CoachClientRelationshipResponseDto[]> {
    return this.service.findForCoach(user, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a relationship the actor belongs to (coach or client)" })
  @ApiParam({ name: "id", description: "Relationship UUID" })
  @ApiResponse({ status: 200, type: CoachClientRelationshipResponseDto })
  findOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<CoachClientRelationshipResponseDto> {
    return this.service.findForActor(user, id);
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Coach manages the relationship lifecycle (pause / resume / end / block)" })
  @ApiParam({ name: "id", description: "Relationship UUID" })
  @ApiResponse({ status: 200, type: CoachClientRelationshipResponseDto })
  updateStatus(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRelationshipStatusDto): Promise<CoachClientRelationshipResponseDto> {
    return this.service.updateStatus(user, id, dto);
  }

  @Get(":id/progress")
  @ApiOperation({ summary: "Coach (or client) views progress scoped to the relationship" })
  @ApiParam({ name: "id", description: "Relationship UUID" })
  @ApiResponse({ status: 200, type: CoachClientProgressResponseDto })
  viewProgress(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Query() query: OverviewQueryDto): Promise<CoachClientProgressResponseDto> {
    return this.service.viewProgress(user, id, query);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Client accepts the coach's invitation" })
  @ApiParam({ name: "id", description: "Relationship UUID" })
  @ApiResponse({ status: 200, type: CoachClientRelationshipResponseDto })
  accept(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<CoachClientRelationshipResponseDto> {
    return this.service.accept(user, id);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Client rejects the coach's invitation" })
  @ApiParam({ name: "id", description: "Relationship UUID" })
  @ApiResponse({ status: 200, type: Object })
  reject(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.service.reject(user, id);
  }
}
