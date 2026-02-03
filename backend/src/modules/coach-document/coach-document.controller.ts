import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CoachDocumentService } from './coach-document.service';
import { CreateCoachDocumentDto, UpdateCoachDocumentDto, CoachDocumentQueryDto, PaginatedCoachDocumentResponseDto, CoachDocumentResponseDto } from './dto';

@ApiTags('Coach Documents')
@Controller('coach-documents')
export class CoachDocumentController {
  constructor(private readonly service: CoachDocumentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a coach document' })
  @ApiResponse({ status: 201, type: CoachDocumentResponseDto })
  create(@Body() dto: CreateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all coach documents' })
  @ApiResponse({ status: 200, type: PaginatedCoachDocumentResponseDto })
  findAll(@Query() query: CoachDocumentQueryDto): Promise<PaginatedCoachDocumentResponseDto> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a coach document by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachDocumentResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CoachDocumentResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a coach document' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CoachDocumentResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a coach document' })
  @ApiParam({ name: 'id' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.service.remove(id);
  }
}
