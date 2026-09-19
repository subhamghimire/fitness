import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe, HttpCode, HttpStatus, UseGuards, Res } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { createReadStream } from "fs";
import { CoachDocumentService } from "./coach-document.service";
import { CreateCoachDocumentDto, UpdateCoachDocumentDto, CoachDocumentQueryDto, PaginatedCoachDocumentResponseDto, CoachDocumentResponseDto } from "./dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

@ApiTags("Coach Documents")
@Controller("coach-documents")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CoachDocumentController {
  constructor(private readonly service: CoachDocumentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Attach a document to the current coach (owner only)" })
  @ApiResponse({ status: 201, type: CoachDocumentResponseDto })
  @ApiResponse({ status: 403, description: "File does not belong to the current user" })
  create(@CurrentUser() user: User, @Body() dto: CreateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    return this.service.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: "List coach documents (owners see only their own; admins may filter any coach)" })
  @ApiResponse({ status: 200, type: PaginatedCoachDocumentResponseDto })
  findAll(@CurrentUser() user: User, @Query() query: CoachDocumentQueryDto): Promise<PaginatedCoachDocumentResponseDto> {
    return this.service.findAll(user, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a coach document (owner or admin only)" })
  @ApiParam({ name: "id" })
  @ApiResponse({ status: 200, type: CoachDocumentResponseDto })
  findOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<CoachDocumentResponseDto> {
    return this.service.findOne(user, id);
  }

  @Get(":id/download")
  @ApiOperation({ summary: "Download the underlying file (owner or admin only)" })
  @ApiParam({ name: "id" })
  async download(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.service.getDownloadableFile(user, id);
    res.set({
      "Content-Type": file.mimetype,
      "Content-Disposition": `attachment; filename="${file.originalName}"`
    });
    createReadStream(file.path).pipe(res);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a document (owner: metadata; admin: review status)" })
  @ApiParam({ name: "id" })
  @ApiResponse({ status: 200, type: CoachDocumentResponseDto })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCoachDocumentDto): Promise<CoachDocumentResponseDto> {
    return this.service.update(user, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete (soft) a coach document (owner or admin)" })
  @ApiParam({ name: "id" })
  remove(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<{ success: boolean; message: string }> {
    return this.service.remove(user, id);
  }
}
