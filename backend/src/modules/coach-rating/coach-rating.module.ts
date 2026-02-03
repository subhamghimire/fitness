import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachRatingService } from './coach-rating.service';
import { CoachRatingController } from './coach-rating.controller';
import { CoachRating } from './entities/coach-rating.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([CoachRating]), AuthModule],
  controllers: [CoachRatingController],
  providers: [CoachRatingService],
  exports: [CoachRatingService]
})
export class CoachRatingModule {}
