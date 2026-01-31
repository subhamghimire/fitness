import { DataSource } from "typeorm";
import type { DataSourceOptions } from "typeorm";
import { config } from "dotenv";
import { join } from "path";

config();

const rootDir = process.cwd();

const options: DataSourceOptions = {
  type: "postgres",
  host: process.env.DATABASE_HOST_ADDRESS,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.POSTGRES_DB,
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,

  logging: false,
  synchronize: false,
  migrationsTableName: "typeorm_migrations",

  entities: [join(rootDir, "src/modules/**/*.entity{.ts,.js}")],
  migrations: [join(rootDir, "database/migrations/*{.ts,.js}")]
};

export default new DataSource(options);
