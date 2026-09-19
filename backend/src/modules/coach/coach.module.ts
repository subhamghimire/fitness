import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachService } from "./coach.service";
import { CoachController } from "./coach.controller";
import { Coach } from "./entities/coach.entity";
import { CoachProfileModule } from "../coach-profile/coach-profile.module";
import { CoachVerificationModule } from "../coach-verification/coach-verification.module";

@Module({
  imports: [TypeOrmModule.forFeature([Coach]), CoachProfileModule, CoachVerificationModule],
  controllers: [CoachController],
  providers: [CoachService],
  exports: [CoachService]
})
export class CoachModule {}
