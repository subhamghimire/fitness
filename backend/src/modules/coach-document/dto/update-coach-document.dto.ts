import { PartialType } from '@nestjs/swagger';
import { CreateCoachDocumentDto } from './create-coach-document.dto';

export class UpdateCoachDocumentDto extends PartialType(CreateCoachDocumentDto) {}
