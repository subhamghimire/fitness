import { Injectable } from '@nestjs/common';
import { CreateCoachRatingDto } from './dto/create-coach-rating.dto';
import { UpdateCoachRatingDto } from './dto/update-coach-rating.dto';

@Injectable()
export class CoachRatingService {
  create(createCoachRatingDto: CreateCoachRatingDto) {
    return 'This action adds a new coachRating';
  }

  findAll() {
    return `This action returns all coachRating`;
  }

  findOne(id: number) {
    return `This action returns a #${id} coachRating`;
  }

  update(id: number, updateCoachRatingDto: UpdateCoachRatingDto) {
    return `This action updates a #${id} coachRating`;
  }

  remove(id: number) {
    return `This action removes a #${id} coachRating`;
  }
}
