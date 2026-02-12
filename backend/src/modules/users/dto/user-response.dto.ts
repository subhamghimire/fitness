import { ApiProperty } from "@nestjs/swagger";
import { Gender } from "../enums";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";

export class UserResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id: string;

  @ApiProperty({ example: "John Doe" })
  name: string;

  @ApiProperty({ example: "john@example.com" })
  email: string;

  @ApiProperty({ example: 25, required: false })
  age?: number;

  @ApiProperty({ enum: Gender, required: false })
  gender?: Gender;

  @ApiProperty({ example: "uploads/avatars/avatar.jpg", required: false })
  avatar: string | null;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedUserResponseDto extends PaginatedResponseDto<UserResponseDto> {
  @ApiProperty({ type: [UserResponseDto] })
  declare data: UserResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
