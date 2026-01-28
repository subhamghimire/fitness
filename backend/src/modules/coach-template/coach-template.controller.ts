import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CoachTemplateService } from './coach-template.service';
import { CreateCoachTemplateDto } from './dto/create-coach-template.dto';
import { UpdateCoachTemplateDto } from './dto/update-coach-template.dto';

@Controller('coach-template')
export class CoachTemplateController {
  constructor(private readonly coachTemplateService: CoachTemplateService) {}

  @Post()
  create(@Body() createCoachTemplateDto: CreateCoachTemplateDto) {
    return this.coachTemplateService.create(createCoachTemplateDto);
  }

  @Get()
  findAll() {
    return this.coachTemplateService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coachTemplateService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCoachTemplateDto: UpdateCoachTemplateDto) {
    return this.coachTemplateService.update(+id, updateCoachTemplateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coachTemplateService.remove(+id);
  }
}
