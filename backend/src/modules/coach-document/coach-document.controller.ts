import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CoachDocumentService } from './coach-document.service';
import { CreateCoachDocumentDto } from './dto/create-coach-document.dto';
import { UpdateCoachDocumentDto } from './dto/update-coach-document.dto';

@Controller('coach-document')
export class CoachDocumentController {
  constructor(private readonly coachDocumentService: CoachDocumentService) {}

  @Post()
  create(@Body() createCoachDocumentDto: CreateCoachDocumentDto) {
    return this.coachDocumentService.create(createCoachDocumentDto);
  }

  @Get()
  findAll() {
    return this.coachDocumentService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.coachDocumentService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCoachDocumentDto: UpdateCoachDocumentDto) {
    return this.coachDocumentService.update(+id, updateCoachDocumentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coachDocumentService.remove(+id);
  }
}
