import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface StorageConfig {
  type: 'local' | 's3';
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  baseUrl?: string;
}

@Injectable()
export class FileUploadService {
  private config: StorageConfig = {
    type: 'local',
    localPath: 'uploads',
    baseUrl: '/uploads'
  };

  constructor() {
    // Ensure upload directory exists
    if (this.config.type === 'local' && this.config.localPath) {
      const uploadDir = path.resolve(this.config.localPath);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    }
  }

  async uploadFile(file: UploadedFile, folder: string = ''): Promise<string> {
    this.validateFile(file);

    if (this.config.type === 'local') {
      return this.uploadToLocal(file, folder);
    }
    
    // Future: Add S3 upload support
    // if (this.config.type === 's3') {
    //   return this.uploadToS3(file, folder);
    // }

    throw new BadRequestException('Unsupported storage type');
  }

  async uploadFiles(files: UploadedFile[], folder: string = ''): Promise<string[]> {
    const urls: string[] = [];
    for (const file of files) {
      const url = await this.uploadFile(file, folder);
      urls.push(url);
    }
    return urls;
  }

  async deleteFile(url: string): Promise<void> {
    if (this.config.type === 'local') {
      return this.deleteFromLocal(url);
    }
    
    // Future: Add S3 delete support
  }

  private validateFile(file: UploadedFile): void {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`
      );
    }

    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }
  }

  private async uploadToLocal(file: UploadedFile, folder: string): Promise<string> {
    const ext = path.extname(file.originalname);
    const filename = `${randomUUID()}${ext}`;
    const folderPath = path.join(this.config.localPath!, folder);
    const filePath = path.join(folderPath, filename);

    // Ensure folder exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Write file
    fs.writeFileSync(filePath, file.buffer);

    // Return URL
    return `${this.config.baseUrl}/${folder ? folder + '/' : ''}${filename}`;
  }

  private async deleteFromLocal(url: string): Promise<void> {
    if (!url.startsWith(this.config.baseUrl!)) return;

    const relativePath = url.replace(this.config.baseUrl!, '');
    const filePath = path.join(this.config.localPath!, relativePath);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Future: S3 upload implementation
  // private async uploadToS3(file: UploadedFile, folder: string): Promise<string> {
  //   // Implement S3 upload using AWS SDK
  //   throw new Error('S3 upload not implemented');
  // }
}
