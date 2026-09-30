import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { PayoutStatus } from "../enums/payout-status.enum";

export class PayoutResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  feeCents: number;

  @ApiProperty()
  netCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: PayoutStatus })
  status: PayoutStatus;

  @ApiProperty()
  payoutReference: string;

  @ApiPropertyOptional()
  failureReason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdatePayoutStatusDto {
  @ApiProperty({ enum: PayoutStatus })
  @IsEnum(PayoutStatus)
  status: PayoutStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  failureReason?: string;
}
