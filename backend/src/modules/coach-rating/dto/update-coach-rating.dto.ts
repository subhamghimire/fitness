import { PartialType } from '@nestjs/swagger';
import { CreateCoachRatingDto } from './create-coach-rating.dto';

export class UpdateCoachRatingDto extends PartialType(CreateCoachRatingDto) {}
