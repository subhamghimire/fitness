import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsInt, Min, Max, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: "Page number" })
  @IsOptional()
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 10, default: 10, description: "Items per page (max 100)" })
  @IsOptional()
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiPropertyOptional({ enum: ["ASC", "DESC"], default: "ASC", description: "Sort order" })
  @IsOptional()
  @IsString()
  sortOrder?: "ASC" | "DESC" = "ASC";
}
