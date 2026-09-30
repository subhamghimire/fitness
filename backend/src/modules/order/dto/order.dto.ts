import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length } from "class-validator";
import { OrderStatus } from "../enums/order-status.enum";

export class CreateOrderDto {
  @ApiProperty({ description: "Product to purchase (must be ACTIVE)" })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({ description: "Client-generated key: retries with the same key return the existing order" })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  idempotencyKey?: string;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  buyerId: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  feeCents: number;

  @ApiProperty()
  netCents: number;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  idempotencyKey: string;

  @ApiPropertyOptional()
  providerPaymentId: string | null;

  @ApiPropertyOptional()
  failureReason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
