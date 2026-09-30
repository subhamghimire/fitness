import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length } from "class-validator";
import { PaymentStatus } from "../enums/payment-status.enum";

export class CheckoutDto {
  @ApiProperty({ description: "PENDING/AWAITING_PAYMENT/FAILED order owned by the caller" })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({ description: "Client key: retries with the same key return the existing payment intent" })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  idempotencyKey?: string;
}

export class CheckoutResponseDto {
  @ApiProperty()
  paymentId: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  providerPaymentId: string;

  @ApiProperty({ description: "Opaque client confirmation secret from the provider" })
  @ApiPropertyOptional()
  clientSecret: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
}

export class PaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  providerPaymentId: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiPropertyOptional()
  failureCode: string | null;

  @ApiPropertyOptional()
  failureMessage: string | null;

  @ApiProperty()
  refundedAmountCents: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class WebhookResultDto {
  @ApiProperty()
  ok: boolean;

  @ApiProperty({ description: "True when this delivery changed nothing (replay, stale, or unknown event)" })
  deduped: boolean;

  @ApiPropertyOptional()
  reason?: string;
}
