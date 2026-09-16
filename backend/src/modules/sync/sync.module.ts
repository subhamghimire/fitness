import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { SyncChange } from "./entities/sync-change.entity";
import { AuthModule } from "../auth/auth.module";
import { WorkoutModule } from "../workout/workout.module";
import { ExerciseModule } from "../exercise/exercise.module";

@Module({
  imports: [TypeOrmModule.forFeature([UserSyncState, SyncChange]), AuthModule, WorkoutModule, ExerciseModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
