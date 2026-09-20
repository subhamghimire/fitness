import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachDashboardController } from "./coach-dashboard.controller";
import { CoachDashboardService } from "./coach-dashboard.service";
import { CoachClientRelationship } from "../coach-client/entities/coach-client-relationship.entity";
import { Coach } from "../coach/entities/coach.entity";
import { Program } from "../program/entities/program.entity";
import { ProgramAssignment } from "../program/entities/program-assignment.entity";
import { ProgramDay } from "../program/entities/program-day.entity";
import { ProgramWorkout } from "../program/entities/program-workout.entity";
import { WorkoutStat } from "../progress/entities/workout-stat.entity";
import { PersonalRecord } from "../progress/entities/personal-record.entity";
import { ExerciseStat } from "../progress/entities/exercise-stat.entity";
import { WorkoutExerciseStat } from "../progress/entities/workout-exercise-stat.entity";
import { ProgressModule } from "../progress/progress.module";
import { AuthModule } from "../auth/auth.module";

/**
 * COACH DASHBOARD DOMAIN
 *
 * Read-only dashboard aggregations for coaches. Reuses the Progress domain
 * (materialized projections) for single-client deep reads and queries the
 * coach-client + program schedule tables directly for scope and adherence.
 */
@Module({
  imports: [
    AuthModule,
    ProgressModule,
    TypeOrmModule.forFeature([
      CoachClientRelationship,
      Coach,
      Program,
      ProgramAssignment,
      ProgramDay,
      ProgramWorkout,
      WorkoutStat,
      PersonalRecord,
      ExerciseStat,
      WorkoutExerciseStat
    ])
  ],
  controllers: [CoachDashboardController],
  providers: [CoachDashboardService],
  exports: [CoachDashboardService]
})
export class CoachDashboardModule {}
