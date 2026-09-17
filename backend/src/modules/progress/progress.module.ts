import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProgressController } from "./progress.controller";
import { ProgressService } from "./progress.service";
import { ProgressQueueService } from "./progress-queue.service";
import { ProgressProjectionService } from "./progress-projection.service";
import { ProgressQueueWorker } from "./progress-queue.worker";
import { AuthModule } from "../auth/auth.module";
import { WorkoutStat } from "./entities/workout-stat.entity";
import { WorkoutExerciseStat } from "./entities/workout-exercise-stat.entity";
import { ExerciseStat } from "./entities/exercise-stat.entity";
import { PersonalRecord } from "./entities/personal-record.entity";
import { ProgressQueueItem } from "./entities/progress-queue-item.entity";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";
import { Set } from "../workout/entities/set.entity";

/**
 * PROGRESS / STATISTICS DOMAIN
 *
 * Owns the materialized statistics, the deterministic calculation engine
 * (`progress.calculator`), the durable reprojection queue and the background
 * worker. The only external coupling is the thin producer hook used by
 * SyncModule (`ProgressQueueService.enqueueWorkoutsInTransaction`) — the
 * projection itself is fully self-contained and never touches sync tables.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WorkoutStat, WorkoutExerciseStat, ExerciseStat, PersonalRecord, ProgressQueueItem, Workout, WorkoutExercise, Set]), AuthModule],
  controllers: [ProgressController],
  providers: [ProgressService, ProgressQueueService, ProgressProjectionService, ProgressQueueWorker],
  exports: [ProgressQueueService, ProgressProjectionService, ProgressService]
})
export class ProgressModule {}
