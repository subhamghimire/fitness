import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiNotFoundResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
import { CoachDashboardService } from "./coach-dashboard.service";
import { CoachActivityQueryDto, CoachClientDetailQueryDto, CoachClientListQueryDto, CoachDashboardQueryDto, CoachMissedWorkoutQueryDto, CoachPendingRequestQueryDto } from "./dto";
import {
  ClientProgressDetailDto,
  CoachDashboardOverviewResponseDto,
  PaginatedClientActivityResponseDto,
  PaginatedClientProgressSummaryResponseDto,
  PaginatedMissedWorkoutResponseDto,
  PaginatedPendingRequestResponseDto
} from "./dto";

/**
 * COACH DASHBOARD API
 *
 * Read-only, dashboard-shaped aggregations for the coach. Every endpoint is
 * rooted in the authenticated coach's own profile and the coach-client
 * relationship, so coach A can never observe coach B's clients (anonymous 404).
 */
@ApiTags("Coach Dashboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("coach-dashboard")
export class CoachDashboardController {
  constructor(private readonly dashboardService: CoachDashboardService) {}

  @Get()
  @ApiOperation({ summary: "Coach dashboard overview (counts, adherence, program progress, recent activity)" })
  @ApiResponse({ status: 200, description: "Dashboard overview", type: CoachDashboardOverviewResponseDto })
  overview(@CurrentUser() user: User, @Query() query: CoachDashboardQueryDto): Promise<CoachDashboardOverviewResponseDto> {
    return this.dashboardService.overview(user, query);
  }

  @Get("clients")
  @ApiOperation({ summary: "Paginated client progress summaries for the coach" })
  @ApiResponse({ status: 200, description: "Paginated client progress summaries", type: PaginatedClientProgressSummaryResponseDto })
  clients(@CurrentUser() user: User, @Query() query: CoachClientListQueryDto): Promise<PaginatedClientProgressSummaryResponseDto> {
    return this.dashboardService.clientSummaries(user, query);
  }

  @Get("requests")
  @ApiOperation({ summary: "Paginated pending client requests for the coach" })
  @ApiResponse({ status: 200, description: "Paginated pending requests", type: PaginatedPendingRequestResponseDto })
  pendingRequests(@CurrentUser() user: User, @Query() query: CoachPendingRequestQueryDto): Promise<PaginatedPendingRequestResponseDto> {
    return this.dashboardService.pendingRequests(user, query);
  }

  @Get("clients/:clientId")
  @ApiOperation({ summary: "Full progress detail for one of the coach's clients" })
  @ApiParam({ name: "clientId", description: "Client user UUID" })
  @ApiResponse({ status: 200, description: "Client progress detail", type: ClientProgressDetailDto })
  @ApiNotFoundResponse({ description: "Client is outside the coach's live relationship scope" })
  clientDetail(@CurrentUser() user: User, @Param("clientId", ParseUUIDPipe) clientId: string, @Query() query: CoachClientDetailQueryDto): Promise<ClientProgressDetailDto> {
    return this.dashboardService.clientDetail(user, clientId, query);
  }

  @Get("activity")
  @ApiOperation({ summary: "Paginated recent client workout activity feed" })
  @ApiResponse({ status: 200, description: "Paginated client activity", type: PaginatedClientActivityResponseDto })
  activity(@CurrentUser() user: User, @Query() query: CoachActivityQueryDto): Promise<PaginatedClientActivityResponseDto> {
    return this.dashboardService.activity(user, query);
  }

  @Get("missed-workouts")
  @ApiOperation({ summary: "Paginated cross-client queue of missed program workout slots, oldest first" })
  @ApiResponse({ status: 200, description: "Paginated missed program workout slots", type: PaginatedMissedWorkoutResponseDto })
  missedWorkouts(@CurrentUser() user: User, @Query() query: CoachMissedWorkoutQueryDto): Promise<PaginatedMissedWorkoutResponseDto> {
    return this.dashboardService.missedWorkouts(user, query);
  }
}
