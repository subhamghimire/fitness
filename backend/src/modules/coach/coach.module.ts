import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachService } from './coach.service';
import { CoachController } from './coach.controller';
import { Coach } from './entities/coach.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Coach])],
  controllers: [CoachController],
  providers: [CoachService],
  exports: [CoachService]
})
export class CoachModule {}
