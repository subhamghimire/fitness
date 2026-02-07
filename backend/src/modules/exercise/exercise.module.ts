import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExerciseService } from './exercise.service';
import { ExerciseController } from './exercise.controller';
import { Exercise } from './entities/exercise.entity';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Exercise]),
    FilesModule
  ],
  controllers: [ExerciseController],
  providers: [ExerciseService],
  exports: [ExerciseService]
})
export class ExerciseModule {}
