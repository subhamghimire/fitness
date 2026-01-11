import { plainToInstance, Type } from "class-transformer";
import { IsEnum, IsInt, IsNotEmpty, IsNumberString, IsString, IsUrl, validateSync } from "class-validator";

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

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST_ADDRESS: string;

  @Type(() => Number)
  @IsInt()
  DATABASE_PORT: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD: string;
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
