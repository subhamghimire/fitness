import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CoachVerificationService } from "./coach-verification.service";
import { UpdateCoachVerificationDto, CoachVerificationResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../shared/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

@ApiTags("Coach Verifications")
@Controller("coach-verifications")
export class CoachVerificationController {
  constructor(private readonly service: CoachVerificationService) {}

  @Post("submit")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Submit (or resubmit) verification for the current coach" })
  @ApiResponse({ status: 201, type: CoachVerificationResponseDto })
  submit(@CurrentUser() user: User): Promise<CoachVerificationResponseDto> {
    return this.service.submitOwn(user);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the current coach's verification record" })
  @ApiResponse({ status: 200, type: CoachVerificationResponseDto })
  getOwn(@CurrentUser() user: User): Promise<CoachVerificationResponseDto> {
    return this.service.getOwnVerification(user);
  }

  @Get(":coachId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a coach's verification record (admin)" })
  @ApiParam({ name: "coachId" })
  @ApiResponse({ status: 200, type: CoachVerificationResponseDto })
  getByCoach(@Param("coachId", ParseUUIDPipe) coachId: string): Promise<CoachVerificationResponseDto> {
    return this.service.getByCoachId(coachId);
  }

  @Patch(":coachId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Advance a coach's verification state (admin)" })
  @ApiParam({ name: "coachId" })
  @ApiResponse({ status: 200, type: CoachVerificationResponseDto })
  transition(@Param("coachId", ParseUUIDPipe) coachId: string, @Body() dto: UpdateCoachVerificationDto, @CurrentUser() admin: User): Promise<CoachVerificationResponseDto> {
    return this.service.transition(coachId, dto, admin);
  }
}
