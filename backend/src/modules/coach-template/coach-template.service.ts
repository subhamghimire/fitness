import { Injectable } from '@nestjs/common';
import { CreateCoachTemplateDto } from './dto/create-coach-template.dto';
import { UpdateCoachTemplateDto } from './dto/update-coach-template.dto';

@Injectable()
export class CoachTemplateService {
  create(createCoachTemplateDto: CreateCoachTemplateDto) {
    return 'This action adds a new coachTemplate';
  }

  findAll() {
    return `This action returns all coachTemplate`;
  }

  findOne(id: number) {
    return `This action returns a #${id} coachTemplate`;
  }

  update(id: number, updateCoachTemplateDto: UpdateCoachTemplateDto) {
    return `This action updates a #${id} coachTemplate`;
  }

  remove(id: number) {
    return `This action removes a #${id} coachTemplate`;
  }
}
