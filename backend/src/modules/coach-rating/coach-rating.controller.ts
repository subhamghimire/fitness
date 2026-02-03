import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { CoachRatingService } from './coach-rating.service';
import { CreateCoachRatingDto, UpdateCoachRatingDto, CoachRatingQueryDto, PaginatedCoachRatingResponseDto, CoachRatingResponseDto, CoachRatingStatsDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Coach Ratings')
@Controller('coach-ratings')
export class CoachRatingController {
  constructor(private readonly service: CoachRatingService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Rate a coach' })
  @ApiResponse({ status: 201, type: CoachRatingResponseDto })
  create(@Req() req: any, @Body() dto: CreateCoachRatingDto): Promise<CoachRatingResponseDto> {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all coach ratings' })
  @ApiResponse({ status: 200, type: PaginatedCoachRatingResponseDto })
  findAll(@Query() query: CoachRatingQueryDto): Promise<PaginatedCoachRatingResponseDto> {
    return this.service.findAll(query);
  }

  @Get('stats/:coachId')
  @ApiOperation({ summary: 'Get rating stats for a coach' })
  @ApiParam({ name: 'coachId' })
  @ApiResponse({ status: 200, type: CoachRatingStatsDto })
  getStats(@Param('coachId', ParseUUIDPipe) coachId: string): Promise<CoachRatingStatsDto> {
    return this.service.getCoachStats(coachId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a rating by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachRatingResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CoachRatingResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your rating' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachRatingResponseDto })
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoachRatingDto): Promise<CoachRatingResponseDto> {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete your rating' })
  @ApiParam({ name: 'id' })
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.service.remove(req.user.id, id);
  }
}
