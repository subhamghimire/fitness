import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { CreateReportDto, ReportPageResponseDto, ReportQueryDto, ReportResponseDto } from "./dto";
import { ReportsService } from "./reports.service";

/**
 * REPORTS HTTP API
 * ---------------------------------------------------------------------------
 * `POST /social/reports` and `GET /social/reports`. Two routes, and the second
 * is scoped to the caller in the service with no way to widen it.
 *
 * There is deliberately **no** "everyone's reports" endpoint and no per-target
 * report count. Both are moderation-tool queries, and putting them on a public
 * authenticated route means the authorisation for them is a filter parameter —
 * i.e. one forgotten parameter exposes the entire queue, including reporters'
 * identities and the exact content they complained about. When the moderation
 * tool is built, it gets its own module and its own role check; this route stays
 * a way for a user to report something and see what happened to their report.
 *
 * The `@Throttle` is the tightest on the platform (10/min) to sit in front of the
 * shared 5-per-day quota, because this is the endpoint where a broken retry loop
 * is most likely and most expensive.
 */
@ApiTags("Social — reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social/reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: "Report a user, post or comment",
    description:
      "You can only report a post or a comment you are able to see. A user is reportable regardless of visibility. One live report per target per reporter — a repeat returns the existing report."
  })
  @ApiResponse({ status: 201, type: ReportResponseDto })
  @ApiResponse({ status: 400, description: "Target id missing for the declared targetType, or reporting yourself" })
  @ApiResponse({ status: 404, description: "Target missing, or a post/comment you cannot see" })
  @ApiResponse({ status: 429, description: "Report quota exhausted (5 per day)" })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(@CurrentUser() user: User, @Body() dto: CreateReportDto): Promise<ReportResponseDto> {
    return this.reportsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "My reports, newest first (cursor-paginated)", description: "Always the caller's own. There is no way to query the whole queue." })
  @ApiResponse({ status: 200, type: ReportPageResponseDto })
  listMine(@CurrentUser() user: User, @Query() query: ReportQueryDto): Promise<ReportPageResponseDto> {
    return this.reportsService.listMine(user.id, query);
  }

  @Get(":id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "One of my reports" })
  @ApiResponse({ status: 200, type: ReportResponseDto })
  @ApiResponse({ status: 404, description: "No such report of yours" })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<ReportResponseDto> {
    return this.reportsService.getMine(user.id, id);
  }
}
