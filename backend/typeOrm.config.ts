import { ConfigService } from "@nestjs/config";
import { DataSourceOptions, DataSource } from "typeorm";
import { config } from "dotenv";
import { SeederOptions, setDataSource } from "typeorm-extension";

config();

const configService = new ConfigService();

console.log("here");

export const typOrmConfig: DataSourceOptions & SeederOptions = {
  type: "postgres",
  host: configService.getOrThrow("DATABASE_HOST_ADDRESS"),
  port: configService.getOrThrow("DATABASE_PORT"),
  database: configService.getOrThrow("POSTGRES_DB"),
  username: configService.getOrThrow("POSTGRES_USER"),
  password: configService.getOrThrow("POSTGRES_PASSWORD"),

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
