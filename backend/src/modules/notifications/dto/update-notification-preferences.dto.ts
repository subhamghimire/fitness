import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { NotificationType } from "../enums";

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: "Receive notifications in the in-app inbox" })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiPropertyOptional({ description: "Receive push notifications on registered devices" })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ description: "Receive notifications over email (opt-in)" })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ enum: NotificationType, isArray: true, description: "Notification kinds to mute" })
  @IsOptional()
  @IsArray()
  @IsEnum(NotificationType, { each: true })
  mutedTypes?: NotificationType[];

  @ApiPropertyOptional({ type: [String], description: "Push provider device tokens; replaces the stored set" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  deviceTokens?: string[];
}

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: "Push provider device token" })
  @IsString()
  @MaxLength(400)
  token: string;

  @ApiPropertyOptional({ enum: ["ios", "android", "web"], default: "android" })
  @IsOptional()
  @Type(() => String)
  @IsString()
  platform?: string;
}
