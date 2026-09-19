import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachRatingService } from "./coach-rating.service";
import { CoachRatingController } from "./coach-rating.controller";
import { CoachRating } from "./entities/coach-rating.entity";
import { Coach } from "../coach/entities/coach.entity";
import { CoachProfileModule } from "../coach-profile/coach-profile.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoachRating, Coach]), CoachProfileModule],
  controllers: [CoachRatingController],
  providers: [CoachRatingService],
  exports: [CoachRatingService]
})
export class CoachRatingModule {}
