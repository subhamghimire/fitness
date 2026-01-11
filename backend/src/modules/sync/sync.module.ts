import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { Workout } from "../workouts/entities/workout.entity";
import { Exercise } from "../workouts/entities/exercise.entity";
import { Set } from "../workouts/entities/set.entity";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [TypeOrmModule.forFeature([Workout, Exercise, Set]), AuthModule],
  controllers: [SyncController],
  providers: [SyncService]
})
export class SyncModule {}
