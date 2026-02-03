import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CoachTemplateService } from './coach-template.service';
import { CreateCoachTemplateDto, UpdateCoachTemplateDto, CoachTemplateQueryDto, PaginatedCoachTemplateResponseDto, CoachTemplateResponseDto } from './dto';

@ApiTags('Coach Templates')
@Controller('coach-templates')
export class CoachTemplateController {
  constructor(private readonly service: CoachTemplateService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a coach template' })
  @ApiResponse({ status: 201, type: CoachTemplateResponseDto })
  create(@Body() dto: CreateCoachTemplateDto): Promise<CoachTemplateResponseDto> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all coach templates' })
  @ApiResponse({ status: 200, type: PaginatedCoachTemplateResponseDto })
  findAll(@Query() query: CoachTemplateQueryDto): Promise<PaginatedCoachTemplateResponseDto> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachTemplateResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CoachTemplateResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachTemplateResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoachTemplateDto): Promise<CoachTemplateResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a template' })
  @ApiParam({ name: 'id' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.service.remove(id);
  }
}
