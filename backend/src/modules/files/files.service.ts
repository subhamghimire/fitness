import { Injectable, NotFoundException, Logger, BadRequestException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { FileEntity } from "./entities/file.entity";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

import { FileFolder } from "./enums/file-folder.enum";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadDir = "uploads";

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

  async uploadFile(file: Express.Multer.File, folder: FileFolder = FileFolder.MISC, ownerId?: string | null): Promise<FileEntity> {
    if (!file) {
      throw new BadRequestException("No file provided");
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
      path: filePath.replace(/\\/g, "/"), // Ensure posix paths
      size: file.size,
      type: folder,
      ownerId: ownerId ?? null
    });

    return this.fileRepository.save(fileEntity);
  }

  async uploadFiles(files: Express.Multer.File[], folder: FileFolder = FileFolder.MISC, ownerId?: string | null): Promise<FileEntity[]> {
    const uploadedFiles: FileEntity[] = [];
    for (const file of files) {
      uploadedFiles.push(await this.uploadFile(file, folder, ownerId));
    }
    return uploadedFiles;
  }

  /**
   * A user may reference an uploaded file only when it exists, lives in the
   * expected folder and was uploaded by that same user.
   */
  async isFileAccessible(fileId: string, user: User, folder?: FileFolder): Promise<boolean> {
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      return false;
    }
    if (folder && file.type !== folder) {
      return false;
    }
    return file.ownerId === user.id;
  }

  /**
   * Files uploaded by a user are private by default: only the owner (or an
   * admin) can read them. Files with no owner (catalog/system assets) remain
   * publicly readable.
   */
  async getReadableFile(id: string, actor?: User): Promise<FileEntity> {
    const file = await this.getFile(id);
    if (file.ownerId && file.ownerId !== actor?.id && actor?.role !== UserRole.ADMIN) {
      throw new ForbiddenException("You do not have permission to access this file");
    }
    return file;
  }

  async deleteFile(id: string, actor?: User): Promise<{ success: boolean; message: string }> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with ID "${id}" not found`);
    }

    const isAdmin = actor?.role === UserRole.ADMIN;
    if (file.ownerId) {
      if (file.ownerId !== actor?.id && !isAdmin) {
        throw new ForbiddenException("You do not have permission to delete this file");
      }
    } else if (!isAdmin) {
      throw new ForbiddenException("Only administrators can delete system files");
    }

    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      await this.fileRepository.remove(file);
      return { success: true, message: "File deleted successfully" };
    } catch (error) {
      this.logger.error(`Failed to delete file ${file.path}: ${(error as Error).message}`);
      throw new BadRequestException("Failed to delete file from storage");
    }
  }

  async getFile(id: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(`File with ID "${id}" not found`);
    }
    return file;
  }

  async getFiles(ids: string[]): Promise<FileEntity[]> {
    const files = await this.fileRepository.find({
      where: { id: In(ids) }
    });

    if (!files || files.length === 0) {
      throw new NotFoundException(`Files with IDs "${ids.join(", ")}" not found`);
    }

    return files;
  }
}
