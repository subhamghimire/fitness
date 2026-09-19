import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CoachProfileService } from "./coach-profile.service";
import { UpdateCoachProfileDto, CoachProfileResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

@ApiTags("Coach Profiles")
@Controller("coach-profiles")
export class CoachProfileController {
  constructor(private readonly service: CoachProfileService) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated coach's profile" })
  @ApiResponse({ status: 200, type: CoachProfileResponseDto })
  getOwn(@CurrentUser() user: User): Promise<CoachProfileResponseDto> {
    return this.service.getOwnProfile(user);
  }

  @Put("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the authenticated coach's profile" })
  @ApiResponse({ status: 200, type: CoachProfileResponseDto })
  updateOwn(@CurrentUser() user: User, @Body() dto: UpdateCoachProfileDto): Promise<CoachProfileResponseDto> {
    return this.service.updateOwnProfile(user, dto);
  }
}
