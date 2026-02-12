import { IsOptional, IsString, IsEmail, IsEnum, IsInt } from "class-validator";
import { Gender } from "../enums";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  age?: number;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  avatarId?: string;
}
