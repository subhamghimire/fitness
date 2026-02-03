import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token received during login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
