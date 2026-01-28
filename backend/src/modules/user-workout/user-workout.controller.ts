import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UserWorkoutService } from './user-workout.service';
import { CreateUserWorkoutDto } from './dto/create-user-workout.dto';
import { UpdateUserWorkoutDto } from './dto/update-user-workout.dto';

@Controller('user-workout')
export class UserWorkoutController {
  constructor(private readonly userWorkoutService: UserWorkoutService) {}

  @Post()
  create(@Body() createUserWorkoutDto: CreateUserWorkoutDto) {
    return this.userWorkoutService.create(createUserWorkoutDto);
  }

  @Get()
  findAll() {
    return this.userWorkoutService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userWorkoutService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserWorkoutDto: UpdateUserWorkoutDto) {
    return this.userWorkoutService.update(+id, updateUserWorkoutDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userWorkoutService.remove(+id);
  }
}
