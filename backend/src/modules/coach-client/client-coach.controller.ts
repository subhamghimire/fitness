import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { CoachClientRelationshipService } from "./coach-client-relationship.service";
import { ClientInvitationResponseDto, ClientCoachResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

/**
 * CLIENT-facing relationship endpoints. All lookups are rooted in the client's
 * own user id — client A can never see client B's coach or invitations.
 */
@ApiTags("Client")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("client")
export class ClientCoachController {
  constructor(private readonly service: CoachClientRelationshipService) {}

  @Get("coach")
  @ApiOperation({ summary: "Client views their current active coach" })
  @ApiResponse({ status: 200, type: ClientCoachResponseDto })
  myCoach(@CurrentUser() user: User): Promise<ClientCoachResponseDto> {
    return this.service.findActiveForClient(user);
  }

  @Get("invitations")
  @ApiOperation({ summary: "Client lists their pending coach invitations" })
  @ApiResponse({ status: 200, type: [ClientInvitationResponseDto] })
  invitations(@CurrentUser() user: User): Promise<ClientInvitationResponseDto[]> {
    return this.service.listInvitationsForClient(user);
  }
}
