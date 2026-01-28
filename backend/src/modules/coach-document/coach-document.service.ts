import { Injectable } from '@nestjs/common';
import { CreateCoachDocumentDto } from './dto/create-coach-document.dto';
import { UpdateCoachDocumentDto } from './dto/update-coach-document.dto';

@Injectable()
export class CoachDocumentService {
  create(createCoachDocumentDto: CreateCoachDocumentDto) {
    return 'This action adds a new coachDocument';
  }

  findAll() {
    return `This action returns all coachDocument`;
  }

  findOne(id: number) {
    return `This action returns a #${id} coachDocument`;
  }

  update(id: number, updateCoachDocumentDto: UpdateCoachDocumentDto) {
    return `This action updates a #${id} coachDocument`;
  }

  remove(id: number) {
    return `This action removes a #${id} coachDocument`;
  }
}
