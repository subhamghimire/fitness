import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FileFolder } from '../enums/file-folder.enum';

export class FileUploadDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'File to upload' })
  file: any;

  @ApiProperty({ 
    enum: FileFolder, 
    default: FileFolder.MISC, 
    description: 'Target folder for the file' 
  })
  @IsOptional()
  @IsEnum(FileFolder)
  folder?: FileFolder = FileFolder.MISC;
}
