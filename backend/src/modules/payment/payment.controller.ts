import { Controller, Get, Post, Body, Param, Headers, Req, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { User } from "src/modules/users/entities/user.entity";
import { PaymentService } from "./payment.service";
import { CheckoutDto, CheckoutResponseDto, PaymentResponseDto, WebhookResultDto } from "./dto/payment.dto";

/** Request carrying the raw webhook bytes (see main.ts raw parser). */
type RawBodyRequest = Request & { rawBody?: Buffer; body?: unknown };

@ApiTags("Marketplace — Payments")
@Controller("payments")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post("checkout")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Buyer starts checkout: creates a provider intent for their order" })
  @ApiResponse({ status: 201, type: CheckoutResponseDto })
  checkout(@CurrentUser() user: User, @Body() dto: CheckoutDto): Promise<CheckoutResponseDto> {
    return this.payments.checkout(user, dto);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Buyer lists payments for their own orders" })
  @ApiResponse({ status: 200, type: [PaymentResponseDto] })
  listMine(@CurrentUser() user: User): Promise<PaymentResponseDto[]> {
    return this.payments.listMine(user);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a payment (buyer, selling coach, or admin)" })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<PaymentResponseDto> {
    return this.payments.getForActor(user, id);
  }

  @Post(":id/refund")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Full refund of a succeeded payment (buyer, selling coach, or admin)" })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  refund(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<PaymentResponseDto> {
    return this.payments.refund(user, id);
  }

  /**
   * Provider webhook. Deliberately NOT behind JWT — the HMAC signature IS the
   * authentication. Always answers 200 for genuine deliveries (including
   * replays) so the provider stops retrying; 401 = bad signature, 400 =
   * malformed body. Requires the raw request bytes: a path-scoped
   * `express.raw` parser (see main.ts) leaves them as a Buffer on `req.body`.
   */
  @Post("webhooks/:provider")
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Provider webhook (HMAC-authenticated, idempotent)" })
  @ApiResponse({ status: 200, type: WebhookResultDto })
  webhook(@Param("provider") provider: string, @Req() req: RawBodyRequest, @Headers("x-payment-signature") signature: string | undefined): Promise<WebhookResultDto> {
    const rawBody: string | Buffer = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {}));
    return this.payments.handleWebhook(provider, rawBody, signature);
  }
}
