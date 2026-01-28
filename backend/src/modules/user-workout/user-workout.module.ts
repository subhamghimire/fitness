import { Module } from '@nestjs/common';
import { UserWorkoutService } from './user-workout.service';
import { UserWorkoutController } from './user-workout.controller';

@Module({
  controllers: [UserWorkoutController],
  providers: [UserWorkoutService],
})
export class UserWorkoutModule {}
