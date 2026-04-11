import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from OAuth flow' })
  @IsString()
  @MinLength(10)
  idToken: string;
}

