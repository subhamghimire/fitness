import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FileFolder } from '../enums/file-folder.enum';

export class FilesUploadDto {
  @ApiProperty({ 
    type: 'array', 
    items: { type: 'string', format: 'binary' }, 
    description: 'Files to upload' 
  })
  files: any[];

  @ApiProperty({ 
    enum: FileFolder, 
    default: FileFolder.MISC, 
    description: 'Target folder for the files' 
  })
  @IsOptional()
  @IsEnum(FileFolder)
  folder?: FileFolder = FileFolder.MISC;
}
