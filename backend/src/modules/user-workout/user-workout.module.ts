import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserWorkoutService } from './user-workout.service';
import { UserWorkoutController } from './user-workout.controller';
import { UserWorkout } from './entities/user-workout.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserWorkout]),
    AuthModule
  ],
  controllers: [UserWorkoutController],
  providers: [UserWorkoutService],
  exports: [UserWorkoutService]
})
export class UserWorkoutModule {}
