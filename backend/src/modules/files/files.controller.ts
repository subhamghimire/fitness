import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  Get,
  Param,
  Delete,
  Res,
  HttpCode,
  HttpStatus,
  Body
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from "@nestjs/swagger";
import { FilesService } from "./files.service";
import { FileEntity } from "./entities/file.entity";
import { Response } from "express";
import { createReadStream } from "fs";
import { FileUploadDto } from "./dto/file-upload.dto";
import { FilesUploadDto } from "./dto/files-upload.dto";
import { UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";

@ApiTags("Files")
@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post("upload")
  @UseGuards(OptionalJwtAuthGuard)
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a single file (becomes private when the uploader is authenticated)" })
  @ApiBody({ type: FileUploadDto })
  @ApiResponse({ status: 201, description: "File uploaded successfully", type: FileEntity })
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10MB
          // new FileTypeValidator({ fileType: '.(png|jpeg|jpg|pdf|doc|docx)' }),
        ],
        fileIsRequired: true
      })
    )
    file: Express.Multer.File,
    @Body() body: FileUploadDto,
    @CurrentUser() user?: User | null
  ) {
    return this.filesService.uploadFile(file, body.folder, user?.id);
  }

  @Post("uploads")
  @UseGuards(OptionalJwtAuthGuard)
  @UseInterceptors(FilesInterceptor("files", 10)) // Max 10 files
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload multiple files (become private when the uploader is authenticated)" })
  @ApiBody({ type: FilesUploadDto })
  @ApiResponse({ status: 201, description: "Files uploaded successfully", type: [FileEntity] })
  async uploadFiles(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10MB per file check
        ],
        fileIsRequired: true
      })
    )
    files: Array<Express.Multer.File>,
    @Body() body: FilesUploadDto,
    @CurrentUser() user?: User | null
  ) {
    return this.filesService.uploadFiles(files, body.folder, user?.id);
  }

  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get file metadata (private files require the owner or an admin)" })
  @ApiParam({ name: "id", description: "File UUID" })
  @ApiResponse({ status: 200, description: "File metadata", type: FileEntity })
  async getFile(@Param("id") id: string, @CurrentUser() user?: User | null) {
    return this.filesService.getReadableFile(id, user ?? undefined);
  }

  @Get(":id/download")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Download file content (private files require the owner or an admin)" })
  @ApiParam({ name: "id", description: "File UUID" })
  async downloadFile(@Param("id") id: string, @Res() res: Response, @CurrentUser() user?: User | null) {
    const file = await this.filesService.getReadableFile(id, user ?? undefined);
    res.set({
      "Content-Type": file.mimetype,
      "Content-Disposition": `attachment; filename="${file.originalName}"`
    });
    const stream = createReadStream(file.path);
    stream.pipe(res);
  }

  @Delete(":id")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a file (owner or admin only)" })
  @ApiParam({ name: "id", description: "File UUID" })
  @ApiResponse({ status: 200, description: "File deleted" })
  async deleteFile(@Param("id") id: string, @CurrentUser() user?: User | null) {
    return this.filesService.deleteFile(id, user ?? undefined);
  }
}
