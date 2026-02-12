import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { PaginationQueryDto } from "src/common/dto";

export class UserWorkoutQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Filter by exercise ID" })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;
}
