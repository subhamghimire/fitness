import { PartialType } from '@nestjs/swagger';
import { CreateUserWorkoutDto } from './create-user-workout.dto';

export class UpdateUserWorkoutDto extends PartialType(CreateUserWorkoutDto) {}
