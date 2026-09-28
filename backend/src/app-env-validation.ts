import { plainToInstance, Type } from "class-transformer";
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf, validateSync } from "class-validator";

enum Environment {
  DEVELOPMENT = "development",
  PRODUCTION = "production",
  TEST = "test",
  DEBUG = "debug",
  STAGING = "staging"
}

/**
 * True when `DATABASE_URL` is absent, i.e. the individual Postgres fields
 * (host/port/db/user/password) must be populated for a local connection.
 */
const requiresHostFields = (env: EnvironmentVariables): boolean => !env.DATABASE_URL;

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

  @ValidateIf(requiresHostFields)
  @IsString()
  @IsNotEmpty()
  DATABASE_HOST_ADDRESS?: string;

  @ValidateIf(requiresHostFields)
  @Type(() => Number)
  @IsInt()
  DATABASE_PORT?: string;

  @ValidateIf(requiresHostFields)
  @IsString()
  @IsNotEmpty()
  POSTGRES_DB?: string;

  @ValidateIf(requiresHostFields)
  @IsString()
  @IsNotEmpty()
  POSTGRES_USER?: string;

  @ValidateIf(requiresHostFields)
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

  // ── Redis (notification job queue + Socket.IO adapter) ─────────────────────
  // Required, not optional: `RedisConnectionFactory` reads it with
  // `getOrThrow`, and it backs both the notification pipeline's background jobs
  // and cross-instance WebSocket fan-out.
  @IsString()
  @IsNotEmpty()
  REDIS_URL: string;

  // ── Notification pipeline tuning (all optional) ───────────────────────────
  /** Outbox rows claimed per relay tick. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  NOTIFICATION_RELAY_BATCH_SIZE?: number;

  /** Outbox relay poll interval, milliseconds. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  NOTIFICATION_RELAY_POLL_MS?: number;

  /** BullMQ attempts for the stage-2 "materialise notifications" job. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  NOTIFICATION_EVENT_JOB_ATTEMPTS?: number;
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
