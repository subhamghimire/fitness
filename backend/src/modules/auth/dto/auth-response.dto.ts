import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiProperty()
  createdAt: string;
}

export class TokensResponseDto {
  @ApiProperty({ description: 'Short-lived access token' })
  accessToken: string;

  @ApiProperty({ description: 'Long-lived refresh token' })
  refreshToken: string;

  @ApiProperty({ description: 'Access token expiry in seconds' })
  expiresIn: number;
}

export class AuthResponseDto {
  @ApiProperty({ type: TokensResponseDto })
  tokens: TokensResponseDto;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}

export class RefreshTokenResponseDto {
  @ApiProperty({ type: TokensResponseDto })
  tokens: TokensResponseDto;
}

export class MessageResponseDto {
  @ApiProperty()
  message: string;
}
