import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachDocumentService } from "./coach-document.service";
import { CoachDocumentController } from "./coach-document.controller";
import { CoachDocument } from "./entities/coach-document.entity";
import { Coach } from "../coach/entities/coach.entity";
import { FilesModule } from "../files/files.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoachDocument, Coach]), FilesModule],
  controllers: [CoachDocumentController],
  providers: [CoachDocumentService],
  exports: [CoachDocumentService]
})
export class CoachDocumentModule {}
