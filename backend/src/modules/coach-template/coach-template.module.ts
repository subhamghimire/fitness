import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachTemplateService } from './coach-template.service';
import { CoachTemplateController } from './coach-template.controller';
import { CoachTemplate } from './entities/coach-template.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CoachTemplate])],
  controllers: [CoachTemplateController],
  providers: [CoachTemplateService],
  exports: [CoachTemplateService]
})
export class CoachTemplateModule {}
