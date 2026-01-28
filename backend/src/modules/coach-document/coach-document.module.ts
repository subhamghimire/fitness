import { Module } from '@nestjs/common';
import { CoachDocumentService } from './coach-document.service';
import { CoachDocumentController } from './coach-document.controller';

@Module({
  controllers: [CoachDocumentController],
  providers: [CoachDocumentService],
})
export class CoachDocumentModule {}
