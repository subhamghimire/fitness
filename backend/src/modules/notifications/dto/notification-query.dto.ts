import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PaginationQueryDto } from "src/common/dto";

const toOptionalBoolean = ({ value }: { value: unknown }): boolean | undefined => (value === undefined ? undefined : value === true || value === "true" || value === "1");

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Return only unread notifications" })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  unreadOnly?: boolean;
}
