import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { CoachService } from "./coach.service";
import { CreateCoachDto, UpdateCoachDto, CoachQueryDto, PaginatedCoachResponseDto, CoachResponseDto, PublicCoachResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import { RolesGuard } from "../../shared/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

@ApiTags("Coaches")
@Controller("coaches")
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a new coach profile for the current user" })
  @ApiResponse({ status: 201, description: "Coach created", type: CoachResponseDto })
  @ApiResponse({ status: 409, description: "User is already a coach" })
  create(@Body() createDto: CreateCoachDto, @CurrentUser() user: User): Promise<CoachResponseDto> {
    return this.coachService.create(createDto, user);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Discover coaches (public). Admins may filter by verification state." })
  @ApiResponse({ status: 200, description: "Paginated coaches", type: PaginatedCoachResponseDto })
  findAll(@Query() query: CoachQueryDto, @CurrentUser() user?: User | null): Promise<PaginatedCoachResponseDto> {
    return this.coachService.findAll(query, user?.role === UserRole.ADMIN);
  }

  @Get("count")
  @ApiOperation({ summary: "Get total discoverable coach count" })
  @ApiResponse({ status: 200, description: "Count", type: Number })
  count(): Promise<number> {
    return this.coachService.count();
  }

  @Get("verified")
  @ApiOperation({ summary: "Get all verified coaches" })
  @ApiResponse({ status: 200, description: "Verified coaches list", type: [PublicCoachResponseDto] })
  getVerified(): Promise<PublicCoachResponseDto[]> {
    return this.coachService.getVerifiedCoaches();
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated coach's full profile" })
  @ApiResponse({ status: 200, type: CoachResponseDto })
  findOwn(@CurrentUser() user: User): Promise<CoachResponseDto> {
    return this.coachService.findOwn(user);
  }

  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get a coach by ID (full detail for owner/admin, public view otherwise)" })
  @ApiParam({ name: "id", description: "Coach UUID" })
  @ApiResponse({ status: 200, description: "Coach found", type: CoachResponseDto })
  @ApiResponse({ status: 404, description: "Coach not found or not publicly discoverable" })
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user?: User | null): Promise<CoachResponseDto> {
    return this.coachService.findOne(id, user ?? undefined);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a coach (owner: name only; admin: rank/account/eligibility)" })
  @ApiParam({ name: "id", description: "Coach UUID" })
  @ApiResponse({ status: 200, description: "Coach updated", type: CoachResponseDto })
  update(@Param("id", ParseUUIDPipe) id: string, @Body() updateDto: UpdateCoachDto, @CurrentUser() user: User): Promise<CoachResponseDto> {
    return this.coachService.update(id, user, updateDto);
  }

  @Patch(":id/enable_disable")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Enable or disable a coach (admin)" })
  @ApiParam({ name: "id", description: "Coach UUID" })
  @ApiResponse({ status: 200, type: CoachResponseDto })
  enableDisable(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: User): Promise<CoachResponseDto> {
    return this.coachService.enableDisable(id, user);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable a coach profile (owner or admin)" })
  @ApiParam({ name: "id", description: "Coach UUID" })
  @ApiResponse({ status: 200, description: "Coach disabled" })
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: User): Promise<{ success: boolean; message: string }> {
    return this.coachService.remove(id, user);
  }
}
