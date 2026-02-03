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
  HttpStatus
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam
} from '@nestjs/swagger';
import { CoachService } from './coach.service';
import {
  CreateCoachDto,
  UpdateCoachDto,
  CoachQueryDto,
  PaginatedCoachResponseDto,
  CoachResponseDto
} from './dto';

@ApiTags('Coaches')
@Controller('coaches')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new coach' })
  @ApiResponse({ status: 201, description: 'Coach created', type: CoachResponseDto })
  create(@Body() createDto: CreateCoachDto): Promise<CoachResponseDto> {
    return this.coachService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all coaches with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated coaches', type: PaginatedCoachResponseDto })
  findAll(@Query() query: CoachQueryDto): Promise<PaginatedCoachResponseDto> {
    return this.coachService.findAll(query);
  }

  @Get('count')
  @ApiOperation({ summary: 'Get total coach count' })
  @ApiResponse({ status: 200, description: 'Count', type: Number })
  count(): Promise<number> {
    return this.coachService.count();
  }

  @Get('verified')
  @ApiOperation({ summary: 'Get all verified coaches' })
  @ApiResponse({ status: 200, description: 'Verified coaches list', type: [CoachResponseDto] })
  getVerified(): Promise<CoachResponseDto[]> {
    return this.coachService.getVerifiedCoaches();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a coach by ID' })
  @ApiParam({ name: 'id', description: 'Coach UUID' })
  @ApiResponse({ status: 200, description: 'Coach found', type: CoachResponseDto })
  @ApiResponse({ status: 404, description: 'Coach not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CoachResponseDto> {
    return this.coachService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a coach' })
  @ApiParam({ name: 'id', description: 'Coach UUID' })
  @ApiResponse({ status: 200, description: 'Coach updated', type: CoachResponseDto })
  @ApiResponse({ status: 404, description: 'Coach not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateCoachDto
  ): Promise<CoachResponseDto> {
    return this.coachService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a coach' })
  @ApiParam({ name: 'id', description: 'Coach UUID' })
  @ApiResponse({ status: 200, description: 'Coach deleted' })
  @ApiResponse({ status: 404, description: 'Coach not found' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.coachService.remove(id);
  }
}
