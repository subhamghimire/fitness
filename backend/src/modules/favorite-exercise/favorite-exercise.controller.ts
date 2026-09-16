import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { FavoriteExerciseService } from "./favorite-exercise.service";
import { CreateFavoriteExerciseDto, UpdateFavoriteExerciseDto, FavoriteExerciseQueryDto, PaginatedFavoriteExerciseResponseDto, FavoriteExerciseResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

type AuthedRequest = Request & { user: { id: string } };

@ApiTags("Favorite Exercises")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(["favorite-exercises", "user-workouts"])
export class FavoriteExerciseController {
  constructor(private readonly favoriteExerciseService: FavoriteExerciseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Add an exercise to your workouts" })
  @ApiResponse({ status: 201, description: "Exercise added", type: FavoriteExerciseResponseDto })
  @ApiResponse({ status: 409, description: "Exercise already added" })
  create(@Req() req: AuthedRequest, @Body() createDto: CreateFavoriteExerciseDto): Promise<FavoriteExerciseResponseDto> {
    return this.favoriteExerciseService.create(req.user.id, createDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all your saved exercises" })
  @ApiResponse({ status: 200, description: "Paginated list", type: PaginatedFavoriteExerciseResponseDto })
  findAll(@Req() req: AuthedRequest, @Query() query: FavoriteExerciseQueryDto): Promise<PaginatedFavoriteExerciseResponseDto> {
    return this.favoriteExerciseService.findAll(req.user.id, query);
  }

  @Get("count")
  @ApiOperation({ summary: "Get count of your saved exercises" })
  @ApiResponse({ status: 200, description: "Count", type: Number })
  count(@Req() req: AuthedRequest): Promise<number> {
    return this.favoriteExerciseService.count(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a specific saved exercise" })
  @ApiParam({ name: "id", description: "Favorite exercise UUID" })
  @ApiResponse({ status: 200, description: "Found", type: FavoriteExerciseResponseDto })
  @ApiResponse({ status: 404, description: "Not found" })
  findOne(@Req() req: AuthedRequest, @Param("id", ParseUUIDPipe) id: string): Promise<FavoriteExerciseResponseDto> {
    return this.favoriteExerciseService.findOne(req.user.id, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update notes for a saved exercise" })
  @ApiParam({ name: "id", description: "Favorite exercise UUID" })
  @ApiResponse({ status: 200, description: "Updated", type: FavoriteExerciseResponseDto })
  @ApiResponse({ status: 404, description: "Not found" })
  update(@Req() req: AuthedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() updateDto: UpdateFavoriteExerciseDto): Promise<FavoriteExerciseResponseDto> {
    return this.favoriteExerciseService.update(req.user.id, id, updateDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Remove an exercise from your workouts" })
  @ApiParam({ name: "id", description: "Favorite exercise UUID" })
  @ApiResponse({ status: 200, description: "Removed" })
  @ApiResponse({ status: 404, description: "Not found" })
  remove(@Req() req: AuthedRequest, @Param("id", ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.favoriteExerciseService.remove(req.user.id, id);
  }
}
