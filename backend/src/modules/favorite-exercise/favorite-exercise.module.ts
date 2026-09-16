import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FavoriteExerciseService } from "./favorite-exercise.service";
import { FavoriteExerciseController } from "./favorite-exercise.controller";
import { FavoriteExercise } from "./entities/favorite-exercise.entity";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [TypeOrmModule.forFeature([FavoriteExercise]), AuthModule],
  controllers: [FavoriteExerciseController],
  providers: [FavoriteExerciseService],
  exports: [FavoriteExerciseService]
})
export class FavoriteExerciseModule {}
