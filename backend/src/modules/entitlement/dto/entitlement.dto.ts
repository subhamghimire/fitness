import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { EntitlementStatus } from "../enums/entitlement-status.enum";

export class EntitlementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  buyerId: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: EntitlementStatus })
  status: EntitlementStatus;

  @ApiProperty()
  activatedAt: Date;

  @ApiPropertyOptional()
  revokedAt: Date | null;

  @ApiPropertyOptional()
  expiresAt: Date | null;
}

export class AccessCheckQueryDto {
  @ApiProperty({ description: "Product to check access for" })
  @IsUUID()
  productId: string;
}

export class AccessCheckResponseDto {
  @ApiProperty()
  hasAccess: boolean;

  @ApiPropertyOptional()
  entitlementId?: string;

  @ApiPropertyOptional()
  expiresAt?: Date | null;
}

export class ExpireCheckDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buyerId?: string;
}
