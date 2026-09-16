import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import * as express from "express";
import * as morgan from "morgan";
import * as useragent from "express-useragent";
import { AppModule } from "./app.module";
import helmet from "helmet";
import { NestExpressApplication } from "@nestjs/platform-express";
import { setupSwagger } from "./setup-swagger";
import { AppExceptionFilter } from "./shared/filters/app-exception.filter";
import { join } from "path";

async function bootstrap() {
  // bodyParser is disabled and re-registered below with an explicit limit so
  // large sync batches are accepted (default express.json limit is 100kb which
  // is too small for a 500-item offline batch).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, bodyParser: false });
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  app.enableCors({ origin: true, credentials: true });
  app.use(morgan("dev"));
  app.use(useragent.express());
  app.setGlobalPrefix("api/v1");

  // Serve static files from uploads directory
  app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads" });

  app.useGlobalFilters(new AppExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: false //@Throws if unknown properties are present
    })
  );

  //Environment variables
  const configService = app.get(ConfigService);
  const PORT = configService.get<number>("PORT", 8848);
  const NODE_ENV = configService.get<string>("NODE_ENV", "development");
  const APP_URL = configService.get<string>("APP_URL");
  const APP_NAME = configService.get<string>("APP_NAME");

  if (NODE_ENV === "production") app.use(helmet());
  else setupSwagger(app, APP_NAME as string);

  // Start Server
  await app.listen(PORT, () => {
    console.log(`Server is starting on ${APP_URL} at ${new Date().toISOString()} with process id:`, process.pid);
    if (NODE_ENV != "production") console.log(`Swagger document ${process.env.APP_URL}/api-docs`);
  });

  // Graceful Shutdown
  const shutdown = (signal: string): void => {
    console.log(`[${signal}]: Server is shutting down at`, new Date());
    void app.close().finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
void bootstrap();
