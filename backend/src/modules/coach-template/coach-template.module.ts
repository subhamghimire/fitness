import { Module } from '@nestjs/common';
import { CoachTemplateService } from './coach-template.service';
import { CoachTemplateController } from './coach-template.controller';

@Module({
  controllers: [CoachTemplateController],
  providers: [CoachTemplateService],
})
export class CoachTemplateModule {}
