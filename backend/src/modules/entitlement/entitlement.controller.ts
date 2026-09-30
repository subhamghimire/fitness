import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { User } from "src/modules/users/entities/user.entity";
import { EntitlementService } from "./entitlement.service";
import { AccessCheckQueryDto, AccessCheckResponseDto, EntitlementResponseDto } from "./dto/entitlement.dto";

@ApiTags("Marketplace — Entitlements")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("entitlements")
export class EntitlementController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get("me")
  @ApiOperation({ summary: "Buyer lists their entitlements" })
  @ApiResponse({ status: 200, type: [EntitlementResponseDto] })
  listMine(@CurrentUser() user: User): Promise<EntitlementResponseDto[]> {
    return this.entitlements.listMine(user);
  }

  @Get("check")
  @ApiOperation({ summary: "Check whether the caller may access a product" })
  @ApiResponse({ status: 200, type: AccessCheckResponseDto })
  check(@CurrentUser() user: User, @Query() query: AccessCheckQueryDto): Promise<AccessCheckResponseDto> {
    return this.entitlements.hasAccess(user.id, query.productId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an entitlement (owner or admin)" })
  @ApiResponse({ status: 200, type: EntitlementResponseDto })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<EntitlementResponseDto> {
    return this.entitlements.getForActor(user, id);
  }
}
