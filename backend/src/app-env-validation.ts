import { plainToInstance, Type } from "class-transformer";
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, validateSync } from "class-validator";

enum Environment {
  DEVELOPMENT = "development",
  PRODUCTION = "production",
  TEST = "test",
  DEBUG = "debug",
  STAGING = "staging"
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsString()
  @IsNotEmpty()
  PORT: string;

  @IsString()
  @IsNotEmpty()
  APP_URL: string;

  @IsString()
  @IsNotEmpty()
  APP_NAME: string;

  // ── Database ──────────────────────────────────────────────────────────────
  // If DATABASE_URL is provided, individual fields are optional (Supabase use-case).
  // If DATABASE_URL is absent, individual fields are required (local Postgres use-case).

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @ValidateIf((o) => !o.DATABASE_URL)
  @IsString()
  @IsNotEmpty()
  DATABASE_HOST_ADDRESS?: string;

  @ValidateIf((o) => !o.DATABASE_URL)
  @Type(() => Number)
  @IsInt()
  DATABASE_PORT?: string;

  @ValidateIf((o) => !o.DATABASE_URL)
  @IsString()
  @IsNotEmpty()
  POSTGRES_DB?: string;

  @ValidateIf((o) => !o.DATABASE_URL)
  @IsString()
  @IsNotEmpty()
  POSTGRES_USER?: string;

  @ValidateIf((o) => !o.DATABASE_URL)
  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD?: string;

  // ── Supabase ──────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  SUPABASE_URL?: string;

  @IsOptional()
  @IsString()
  SUPABASE_ANON_KEY?: string;

  @IsOptional()
  @IsString()
  SUPABASE_SERVICE_ROLE_KEY?: string;

  // ── JWT ───────────────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRY?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRY?: string;

  // ── Google OAuth ──────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_IDS?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    for (const error of errors) {
      if (error.constraints) {
        const errorMessage = Object.values(error.constraints)[0];
        throw new Error(errorMessage + " in the env file.");
      }
    }
  }

  return validatedConfig;
}
