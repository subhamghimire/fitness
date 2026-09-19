import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Program } from "./entities/program.entity";
import { ProgramDay } from "./entities/program-day.entity";
import { ProgramWorkout } from "./entities/program-workout.entity";
import { ProgramAssignment } from "./entities/program-assignment.entity";
import { Coach } from "../coach/entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { CoachClientRelationship } from "../coach-client/entities/coach-client-relationship.entity";
import { WorkoutTemplate } from "../workout/entities/workout-template.entity";
import { WorkoutStat } from "../progress/entities/workout-stat.entity";
import { ProgramService } from "./program.service";
import { ProgramAssignmentService } from "./program-assignment.service";
import { ProgramController } from "./program.controller";
import { ClientProgramController } from "./client-program.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Program, ProgramDay, ProgramWorkout, ProgramAssignment, Coach, User, CoachClientRelationship, WorkoutTemplate, WorkoutStat])],
  controllers: [ProgramController, ClientProgramController],
  providers: [ProgramService, ProgramAssignmentService],
  exports: [ProgramService, ProgramAssignmentService]
})
export class ProgramModule {}
