import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth
} from '@nestjs/swagger';
import { UserWorkoutService } from './user-workout.service';
import {
  CreateUserWorkoutDto,
  UpdateUserWorkoutDto,
  UserWorkoutQueryDto,
  PaginatedUserWorkoutResponseDto,
  UserWorkoutResponseDto
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('User Workouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user-workouts')
export class UserWorkoutController {
  constructor(private readonly userWorkoutService: UserWorkoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an exercise to your workouts' })
  @ApiResponse({ status: 201, description: 'Exercise added', type: UserWorkoutResponseDto })
  @ApiResponse({ status: 409, description: 'Exercise already added' })
  create(
    @Req() req: any,
    @Body() createDto: CreateUserWorkoutDto
  ): Promise<UserWorkoutResponseDto> {
    return this.userWorkoutService.create(req.user.id, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all your saved exercises' })
  @ApiResponse({ status: 200, description: 'Paginated list', type: PaginatedUserWorkoutResponseDto })
  findAll(
    @Req() req: any,
    @Query() query: UserWorkoutQueryDto
  ): Promise<PaginatedUserWorkoutResponseDto> {
    return this.userWorkoutService.findAll(req.user.id, query);
  }

  @Get('count')
  @ApiOperation({ summary: 'Get count of your saved exercises' })
  @ApiResponse({ status: 200, description: 'Count', type: Number })
  count(@Req() req: any): Promise<number> {
    return this.userWorkoutService.count(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific saved exercise' })
  @ApiParam({ name: 'id', description: 'User workout UUID' })
  @ApiResponse({ status: 200, description: 'Found', type: UserWorkoutResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<UserWorkoutResponseDto> {
    return this.userWorkoutService.findOne(req.user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update notes for a saved exercise' })
  @ApiParam({ name: 'id', description: 'User workout UUID' })
  @ApiResponse({ status: 200, description: 'Updated', type: UserWorkoutResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateUserWorkoutDto
  ): Promise<UserWorkoutResponseDto> {
    return this.userWorkoutService.update(req.user.id, id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an exercise from your workouts' })
  @ApiParam({ name: 'id', description: 'User workout UUID' })
  @ApiResponse({ status: 200, description: 'Removed' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<{ success: boolean; message: string }> {
    return this.userWorkoutService.remove(req.user.id, id);
  }
}
