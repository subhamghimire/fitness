import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkoutController } from "./workout.controller";
import { WorkoutService } from "./workout.service";
import { Workout } from "./entities/workout.entity";
import { WorkoutExercise } from "./entities/workout-exercise.entity";
import { Set } from "./entities/set.entity";
import { WorkoutTemplateController } from "./workout-template.controller";
import { WorkoutTemplateService } from "./workout-template.service";
import { WorkoutTemplate } from "./entities/workout-template.entity";
import { WorkoutTemplateExercise } from "./entities/workout-template-exercise.entity";
import { WorkoutTemplateSet } from "./entities/workout-template-set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { ExerciseModule } from "../exercise/exercise.module";
import { AuthModule } from "../auth/auth.module";
import { SyncChange } from "../sync/entities/sync-change.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([Workout, WorkoutExercise, Set, Exercise, WorkoutTemplate, WorkoutTemplateExercise, WorkoutTemplateSet, SyncChange]),
    ExerciseModule,
    AuthModule
  ],
  controllers: [WorkoutController, WorkoutTemplateController],
  providers: [WorkoutService, WorkoutTemplateService],
  exports: [WorkoutService, WorkoutTemplateService]
})
export class WorkoutModule {}
