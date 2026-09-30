import { Controller, Get, Post, Body, Param, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "src/shared/guards/roles.guard";
import { Roles } from "src/modules/auth/decorators/roles.decorator";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { PayoutService } from "./payout.service";
import { PayoutResponseDto, UpdatePayoutStatusDto } from "./dto/payout.dto";

@ApiTags("Marketplace — Payouts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("payouts")
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get("mine")
  @ApiOperation({ summary: "Coach lists their payouts (admin: all)" })
  @ApiResponse({ status: 200, type: [PayoutResponseDto] })
  listMine(@CurrentUser() user: User): Promise<PayoutResponseDto[]> {
    return this.payouts.listMine(user);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a payout (owning coach or admin)" })
  @ApiResponse({ status: 200, type: PayoutResponseDto })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<PayoutResponseDto> {
    return this.payouts.getForActor(user, id);
  }

  @Post(":id/status")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Admin moves a payout along its state machine" })
  @ApiResponse({ status: 200, type: PayoutResponseDto })
  setStatus(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePayoutStatusDto): Promise<PayoutResponseDto> {
    return this.payouts.setStatus(user, id, dto.status, dto.failureReason);
  }
}
