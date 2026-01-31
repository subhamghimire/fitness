import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import * as morgan from "morgan";
import { AppModule } from "./app.module";
import helmet from "helmet";
import { NestExpressApplication } from "@nestjs/platform-express";
import { setupSwagger } from "./setup-swagger";
import { AppExceptionFilter } from "./shared/filters/app-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.enableCors({ origin: true, credentials: true });
  app.use(morgan("dev"));
  app.setGlobalPrefix("api/v1");

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
    console.log(`Server is starting on ${APP_URL} at ${new Date()} with process id:`, process.pid);
    if (NODE_ENV != "production") console.log(`Swagger document ${process.env.APP_URL}/api-docs`);
  });

  // Graceful Shutdown
  const shutdown = (signal: string): void => {
    console.log(`[${signal}]: Server is shutting down at`, new Date());
    app.close().finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
bootstrap();
