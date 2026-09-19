import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachProfileService } from "./coach-profile.service";
import { CoachProfileController } from "./coach-profile.controller";
import { CoachProfile } from "./entities/coach-profile.entity";
import { Coach } from "../coach/entities/coach.entity";
import { FilesModule } from "../files/files.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoachProfile, Coach]), FilesModule],
  controllers: [CoachProfileController],
  providers: [CoachProfileService],
  exports: [CoachProfileService]
})
export class CoachProfileModule {}
