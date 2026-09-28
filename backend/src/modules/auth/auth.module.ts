import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { User } from "../users/entities/user.entity";
import { RefreshToken } from "./entities/refresh-token.entity";
import { PasswordResetToken } from "./entities/password-reset-token.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, PasswordResetToken]),
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow("JWT_SECRET"),
        signOptions: {
          expiresIn: parseInt(configService.get("JWT_ACCESS_EXPIRY") || "900") // 15 min default
        }
      }),
      inject: [ConfigService]
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // `JwtModule` is exported so the messaging gateway can verify a socket's access
  // token with the same secret this module signs with, rather than registering a
  // second `JwtModule` that could drift (or arrive without a secret).
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule]
})
export class AuthModule {}
