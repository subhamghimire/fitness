import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { SyncModule } from "./modules/sync/sync.module";

export function setupSwagger(app: INestApplication, APP_NAME: string): void {
  const options = new DocumentBuilder()
    .setTitle(APP_NAME)
    .setDescription("API description")
    .setVersion("1.0")
    .addBearerAuth({
      description: `Please enter token in following format: Bearer <JWT>`,
      name: "Authorization",
      bearerFormat: "Bearer",
      scheme: "Bearer",
      type: "http",
      in: "Header"
    })
    .addApiKey(
      {
        type: "apiKey",
        name: "x-api-key",
        in: "header",
        description: "Enter your API key"
      },
      "x-api-key"
    )
    .build();

  const apiDocument = SwaggerModule.createDocument(app, options, {
    include: [SyncModule]
  });

  SwaggerModule.setup("/api-docs", app, apiDocument);
}
