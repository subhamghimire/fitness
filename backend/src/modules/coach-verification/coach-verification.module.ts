import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachVerificationService } from "./coach-verification.service";
import { CoachVerificationController } from "./coach-verification.controller";
import { CoachVerification } from "./entities/coach-verification.entity";
import { Coach } from "../coach/entities/coach.entity";

@Module({
  imports: [TypeOrmModule.forFeature([CoachVerification, Coach])],
  controllers: [CoachVerificationController],
  providers: [CoachVerificationService],
  exports: [CoachVerificationService]
})
export class CoachVerificationModule {}
