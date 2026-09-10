import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { Workout } from "../workouts/entities/workout.entity";
import { WorkoutExercise } from "../workouts/entities/workout-exercise.entity";
import { Set } from "../workouts/entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { UserTemplate } from "../workouts/entities/user-template.entity";
import { UserTemplateExercise } from "../workouts/entities/user-template-exercise.entity";
import { UserTemplateSet } from "../workouts/entities/user-template-set.entity";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workout,
      WorkoutExercise,
      Set,
      Exercise,
      UserTemplate,
      UserTemplateExercise,
      UserTemplateSet,
      UserSyncState
    ]),
    AuthModule
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
