import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import type { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import { config } from "dotenv";
import { SeederOptions, setDataSource } from "typeorm-extension";

config();

const configService = new ConfigService();

const isProduction = configService.get("NODE_ENV") !== "development";
const databaseUrl = configService.get<string>("DATABASE_URL");

export const typOrmConfig: PostgresConnectionOptions & SeederOptions = {
  type: "postgres",

  // If DATABASE_URL is set (Supabase), use it; otherwise fall back to individual fields.
  ...(databaseUrl
    ? {
        url: databaseUrl,
        ssl: { rejectUnauthorized: false } // Required for Supabase
      }
    : {
        host: configService.getOrThrow("DATABASE_HOST_ADDRESS"),
        port: Number(configService.getOrThrow("DATABASE_PORT")),
        database: configService.getOrThrow("POSTGRES_DB"),
        username: configService.getOrThrow("POSTGRES_USER"),
        password: configService.getOrThrow("POSTGRES_PASSWORD"),
        ssl: isProduction ? { rejectUnauthorized: false } : false
      }),

  logging: false,
  synchronize: false,

  migrationsTableName: "typeorm_migrations",
  entities: [__dirname + "/src/modules/**/*.entity{.ts,.js}"],
  subscribers: [__dirname + "/src/modules/**/*.subscriber{.ts,.js}"],

  migrations: [__dirname + "/database/migrations/*{.ts,.js}"],
  factories: [__dirname + "/database/factories/*{.ts,.js}"],
  seeds: [__dirname + "/database/seeds/*{.ts,.js}"],
  seedTracking: true
};

export const dataSourceOrm = new DataSource(typOrmConfig);
setDataSource(dataSourceOrm);
