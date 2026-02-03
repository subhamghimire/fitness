import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ExerciseService } from './exercise.service';
import { ExerciseController } from './exercise.controller';
import { Exercise } from './entities/exercise.entity';
import { FileUploadService } from 'src/common/services';

@Module({
  imports: [
    TypeOrmModule.forFeature([Exercise]),
    MulterModule.register({
      storage: memoryStorage()
    })
  ],
  controllers: [ExerciseController],
  providers: [ExerciseService, FileUploadService],
  exports: [ExerciseService]
})
export class ExerciseModule {}
