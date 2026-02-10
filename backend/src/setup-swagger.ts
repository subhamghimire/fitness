import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

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
    .build();

  const apiDocument = SwaggerModule.createDocument(app, options, {
    autoTagControllers: true
  });

  SwaggerModule.setup("/api-docs", app, apiDocument);
}
