import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCoachRatingDto } from './create-coach-rating.dto';

export class UpdateCoachRatingDto extends PartialType(OmitType(CreateCoachRatingDto, ['coachId'] as const)) {}
