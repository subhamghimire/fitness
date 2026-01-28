import { PartialType } from '@nestjs/swagger';
import { CreateCoachTemplateDto } from './create-coach-template.dto';

export class UpdateCoachTemplateDto extends PartialType(CreateCoachTemplateDto) {}
