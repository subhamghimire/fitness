import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoachClientRelationship } from "./entities/coach-client-relationship.entity";
import { Coach } from "../coach/entities/coach.entity";
import { User } from "../users/entities/user.entity";
import { CoachClientRelationshipService } from "./coach-client-relationship.service";
import { CoachClientRelationshipController } from "./coach-client-relationship.controller";
import { ClientCoachController } from "./client-coach.controller";

@Module({
  imports: [TypeOrmModule.forFeature([CoachClientRelationship, Coach, User])],
  controllers: [CoachClientRelationshipController, ClientCoachController],
  providers: [CoachClientRelationshipService],
  exports: [CoachClientRelationshipService, TypeOrmModule]
})
export class CoachClientModule {}
