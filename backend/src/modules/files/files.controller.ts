import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Get,
  Param,
  Delete,
  Res,
  HttpCode,
  HttpStatus,
  Query,
  Body
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { FileEntity } from './entities/file.entity';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';
import { FileFolder } from './enums/file-folder.enum';
import { FileUploadDto } from './dto/file-upload.dto';
import { FilesUploadDto } from './dto/files-upload.dto';

@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a single file' })
  @ApiBody({ type: FileUploadDto })
  @ApiResponse({ status: 201, description: 'File uploaded successfully', type: FileEntity })
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          // new FileTypeValidator({ fileType: '.(png|jpeg|jpg|pdf|doc|docx)' }),
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body() body: FileUploadDto
  ) {
    return this.filesService.uploadFile(file, body.folder);
  }

  @Post('uploads')
  @UseInterceptors(FilesInterceptor('files', 10)) // Max 10 files
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiBody({ type: FilesUploadDto })
  @ApiResponse({ status: 201, description: 'Files uploaded successfully', type: [FileEntity] })
  async uploadFiles(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB per file check
        ],
        fileIsRequired: true,
      }),
    )
    files: Array<Express.Multer.File>,
    @Body() body: FilesUploadDto
  ) {
    return this.filesService.uploadFiles(files, body.folder);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiResponse({ status: 200, description: 'File metadata', type: FileEntity })
  async getFile(@Param('id') id: string) {
    return this.filesService.getFile(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download file content' })
  @ApiParam({ name: 'id', description: 'File UUID' })
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const file = await this.filesService.getFile(id);
    res.set({
      'Content-Type': file.mimetype,
      'Content-Disposition': `attachment; filename="${file.originalName}"`,
    });
    const stream = createReadStream(file.path);
    stream.pipe(res);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a file' })
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiResponse({ status: 200, description: 'File deleted' })
  async deleteFile(@Param('id') id: string) {
    return this.filesService.deleteFile(id);
  }
}
