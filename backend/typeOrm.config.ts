import { DataSource } from "typeorm";
import type { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import type { SeederOptions } from "typeorm-extension";
import { setDataSource } from "typeorm-extension";
import { config } from "dotenv";
import { join } from "path";

config();

const rootDir = process.cwd();

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV !== "development";

const options: PostgresConnectionOptions & SeederOptions = {
  type: "postgres",

  // If DATABASE_URL is set (Supabase), use it; otherwise fall back to individual fields.
  ...(databaseUrl
    ? {
        url: databaseUrl,
        ssl: { rejectUnauthorized: false } // Required for Supabase
      }
    : {
        host: process.env.DATABASE_HOST_ADDRESS,
        port: Number(process.env.DATABASE_PORT),
        database: process.env.POSTGRES_DB,
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        ssl: isProduction ? { rejectUnauthorized: false } : false
      }),

  synchronize: false,
  logging: false,

  entities: [join(rootDir, "src/modules/**/*.entity{.ts,.js}")],
  migrations: [join(rootDir, "database/migrations/*{.ts,.js}")],

  seeds: [join(rootDir, "database/seeds/*{.ts,.js}")],
  factories: [join(rootDir, "database/factories/*{.ts,.js}")],
  seedTracking: true
};

const dataSource = new DataSource(options);
setDataSource(dataSource);

export default dataSource;
