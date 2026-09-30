import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";
import { BillingInterval, ProductStatus, ProductType } from "../enums/product.enum";
import { ProgramResponseDto } from "src/modules/program/dto";

export class CreateProductDto {
  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type: ProductType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: "Price in minor units (cents), must be > 0" })
  @IsInt()
  @Min(1)
  priceCents: number;

  @ApiPropertyOptional({ default: "USD" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ description: "Linked program for training_program products" })
  @IsOptional()
  @IsUUID()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coachId?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class ProductResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty({ enum: ProductType })
  type: ProductType;

  @ApiProperty({ enum: ProductStatus })
  status: ProductStatus;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty()
  priceCents: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional()
  billingInterval: string | null;

  @ApiPropertyOptional()
  programId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedProductResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items: ProductResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  offset: number;
}

export class PublishProductDto {
  @ApiProperty({ description: "Set true to publish (DRAFT → ACTIVE), false to unpublish (ACTIVE → DRAFT)" })
  @IsNotEmpty()
  active: boolean;
}

export class ProductContentResponseDto {
  @ApiProperty({ description: "The purchased product" })
  product: ProductResponseDto;

  @ApiPropertyOptional({ description: "Full program detail for training_program products with a linked program" })
  program: ProgramResponseDto | null;

  @ApiPropertyOptional({ description: "Access expiry for subscriptions; null for lifetime purchases" })
  expiresAt: Date | null;
}
