import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CoachRatingService } from './coach-rating.service';
import { CreateCoachRatingDto } from './dto/create-coach-rating.dto';
import { UpdateCoachRatingDto } from './dto/update-coach-rating.dto';

@Controller('coach-rating')
export class CoachRatingController {
  constructor(private readonly coachRatingService: CoachRatingService) {}

  @Post()
  create(@Body() createCoachRatingDto: CreateCoachRatingDto) {
    return this.coachRatingService.create(createCoachRatingDto);
  }

  @Get()
  findAll() {
    return this.coachRatingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coachRatingService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCoachRatingDto: UpdateCoachRatingDto) {
    return this.coachRatingService.update(+id, updateCoachRatingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coachRatingService.remove(+id);
  }
}
