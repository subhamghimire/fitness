import { Module } from '@nestjs/common';
import { CoachRatingService } from './coach-rating.service';
import { CoachRatingController } from './coach-rating.controller';

@Module({
  controllers: [CoachRatingController],
  providers: [CoachRatingService],
})
export class CoachRatingModule {}
