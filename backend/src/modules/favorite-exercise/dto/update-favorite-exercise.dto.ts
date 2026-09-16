import { PartialType } from "@nestjs/swagger";
import { CreateFavoriteExerciseDto } from "./create-favorite-exercise.dto";

export class UpdateFavoriteExerciseDto extends PartialType(CreateFavoriteExerciseDto) {}
