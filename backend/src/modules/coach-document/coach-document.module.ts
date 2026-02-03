import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachDocumentService } from './coach-document.service';
import { CoachDocumentController } from './coach-document.controller';
import { CoachDocument } from './entities/coach-document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CoachDocument])],
  controllers: [CoachDocumentController],
  providers: [CoachDocumentService],
  exports: [CoachDocumentService]
})
export class CoachDocumentModule {}
