import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from "@nestjs/common";
import { SyncService } from "./sync.service";
import { SyncWorkoutDto } from "./dto/sync-workout.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
@Controller("sync")
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}
  @Post("workouts") @HttpCode(HttpStatus.OK) syncWorkout(@Body() dto: SyncWorkoutDto, @CurrentUser() user: User) {
    return this.syncService.syncWorkout(dto, user);
  }
}
