// import { DataSource } from "typeorm";
// import type { DataSourceOptions } from "typeorm";
// import { config } from "dotenv";
// import { join } from "path";
// import { SeederOptions, setDataSource } from "typeorm-extension";

// config();

// const rootDir = process.cwd();

// const options: DataSourceOptions & SeederOptions = {
//   type: "postgres",
//   host: process.env.DATABASE_HOST_ADDRESS,
//   port: Number(process.env.DATABASE_PORT),
//   database: process.env.POSTGRES_DB,
//   username: process.env.POSTGRES_USER,
//   password: process.env.POSTGRES_PASSWORD,

//   logging: false,
//   synchronize: false,
//   migrationsTableName: "typeorm_migrations",

//   entities: [join(rootDir, "src/modules/**/*.entity{.ts,.js}")],
//   migrations: [join(rootDir, "database/migrations/*{.ts,.js}")],
//   seeds: [join(rootDir, "database/seeds/*{.ts,.js}")]
// };

// const dataSource = new DataSource(options);
// setDataSource(dataSource);

// export default dataSource;

import { DataSource } from "typeorm";
import type { DataSourceOptions } from "typeorm";
import type { SeederOptions } from "typeorm-extension";
import { setDataSource } from "typeorm-extension";
import { config } from "dotenv";
import { join } from "path";

config();

const rootDir = process.cwd();

const options: DataSourceOptions & SeederOptions = {
  type: "postgres",
  host: process.env.DATABASE_HOST_ADDRESS,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.POSTGRES_DB,
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,

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
