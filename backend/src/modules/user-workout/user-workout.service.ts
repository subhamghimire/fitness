import { Injectable } from '@nestjs/common';
import { CreateUserWorkoutDto } from './dto/create-user-workout.dto';
import { UpdateUserWorkoutDto } from './dto/update-user-workout.dto';

@Injectable()
export class UserWorkoutService {
  create(createUserWorkoutDto: CreateUserWorkoutDto) {
    return 'This action adds a new userWorkout';
  }

  findAll() {
    return `This action returns all userWorkout`;
  }

  findOne(id: number) {
    return `This action returns a #${id} userWorkout`;
  }

  update(id: number, updateUserWorkoutDto: UpdateUserWorkoutDto) {
    return `This action updates a #${id} userWorkout`;
  }

  remove(id: number) {
    return `This action removes a #${id} userWorkout`;
  }
}
