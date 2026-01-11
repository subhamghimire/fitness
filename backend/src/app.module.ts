import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { SyncModule } from "./modules/sync/sync.module";
import { DbModule } from "./shared/db/db.module";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./app-env-validation";
import { APP_GUARD } from "@nestjs/core";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env", validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // Time window in MS
        limit: 10 // Max requests per window
      }
    ]),
    DbModule,

    AuthModule,
    SyncModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
