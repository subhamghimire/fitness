import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { FileFolder } from './enums/file-folder.enum';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadDir = 'uploads';

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>
  ) {
    this.ensureUploadDirExists();
  }

  private ensureUploadDirExists() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: Express.Multer.File, folder: FileFolder = FileFolder.MISC): Promise<FileEntity> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const targetDir = path.join(this.uploadDir, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filename = `${uuidv4()}${path.extname(file.originalname)}`;
    const filePath = path.join(targetDir, filename);

    // Write file to disk
    fs.writeFileSync(filePath, file.buffer);

    // Save entity
    const fileEntity = this.fileRepository.create({
      originalName: file.originalname,
      filename: filename,
      mimetype: file.mimetype,
      path: filePath.replace(/\\/g, '/'), // Ensure posix paths
      size: file.size,
      type: folder
    });

    return this.fileRepository.save(fileEntity);
  }

  async uploadFiles(files: Express.Multer.File[], folder: FileFolder = FileFolder.MISC): Promise<FileEntity[]> {
    const uploadedFiles: FileEntity[] = [];
    for (const file of files) {
      uploadedFiles.push(await this.uploadFile(file, folder));
    }
    return uploadedFiles;
  }

  async deleteFile(id: string): Promise<{ success: boolean; message: string }> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with ID "${id}" not found`);
    }

    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      await this.fileRepository.remove(file);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete file ${file.path}: ${error.message}`);
      throw new BadRequestException('Failed to delete file from storage');
    }
  }

  async getFile(id: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with ID "${id}" not found`);
    }
    return file;
  }
}
