import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { SyncModule } from "./modules/sync/sync.module";
import { DbModule } from "./shared/db/db.module";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./app-env-validation";
import { APP_GUARD } from "@nestjs/core";
import { CoachModule } from "./modules/coach/coach.module";
import { CoachDocumentModule } from "./modules/coach-document/coach-document.module";
import { CoachTemplateModule } from './modules/coach-template/coach-template.module';
import { CoachRatingModule } from './modules/coach-rating/coach-rating.module';
import { ExerciseModule } from './modules/exercise/exercise.module';
import { UserWorkoutModule } from './modules/user-workout/user-workout.module';

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
    SyncModule,
    CoachModule,
    CoachDocumentModule,
    CoachTemplateModule,
    CoachRatingModule,
    ExerciseModule,
    UserWorkoutModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
