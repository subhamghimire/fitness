import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { SyncModule } from "./modules/sync/sync.module";
import { DbModule } from "./shared/db/db.module";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./app-env-validation";
import { APP_GUARD } from "@nestjs/core";
import { CoachModule } from "./modules/coach/coach.module";
import { CoachDocumentModule } from "./modules/coach-document/coach-document.module";
import { CoachTemplateModule } from "./modules/coach-template/coach-template.module";
import { CoachRatingModule } from "./modules/coach-rating/coach-rating.module";
import { ExerciseModule } from "./modules/exercise/exercise.module";
import { FavoriteExerciseModule } from "./modules/favorite-exercise/favorite-exercise.module";
import { WorkoutModule } from "./modules/workout/workout.module";
import { ProgressModule } from "./modules/progress/progress.module";
import { CoachClientModule } from "./modules/coach-client/coach-client.module";
import { CoachDashboardModule } from "./modules/coach-dashboard/coach-dashboard.module";
import { ProgramModule } from "./modules/program/program.module";
import { FilesModule } from "./modules/files/files.module";
import { UserModule } from "./modules/users/user.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { HealthController } from "./common/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env", validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // Time window in MS
        limit: 60 // Max requests per window
      }
    ]),
    DbModule,

    // NotificationsModule comes before its producers: it provides the
    // `DomainEventPublisher` token that MessagingModule (below) injects, and the
    // producer modules that publish events depend on it too. The producers still
    // only import the `common/events` contract, so this ordering is a wiring
    // detail and not a source-level dependency.
    NotificationsModule,

    AuthModule,
    SyncModule,
    CoachModule,
    CoachDocumentModule,
    CoachTemplateModule,
    CoachRatingModule,
    ExerciseModule,
    FavoriteExerciseModule,
    WorkoutModule,
    ProgressModule,
    CoachClientModule,
    CoachDashboardModule,
    ProgramModule,
    FilesModule,
    UserModule,
    MessagingModule
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
