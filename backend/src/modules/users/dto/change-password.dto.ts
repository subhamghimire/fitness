import { IsString, MinLength } from "class-validator";
import { IsSamePassword } from "./custom-validator/same-password.validator";

export class ChangePasswordDto {
  @IsString()
  oldPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;

  @IsString()
  @MinLength(6)
  @IsSamePassword()
  confirmPassword: string;
}
