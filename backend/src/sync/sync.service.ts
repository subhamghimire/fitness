import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workout } from '../workouts/entities/workout.entity';
import { Exercise } from '../workouts/entities/exercise.entity';
import { Set } from '../workouts/entities/set.entity';
import { User } from '../users/entities/user.entity';
import { SyncWorkoutDto } from './dto/sync-workout.dto';
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  constructor(@InjectRepository(Workout) private workoutsRepo: Repository<Workout>, @InjectRepository(Exercise) private exercisesRepo: Repository<Exercise>, @InjectRepository(Set) private setsRepo: Repository<Set>, private dataSource: DataSource) {}
  async syncWorkout(dto: SyncWorkoutDto, user: User): Promise<{ success: boolean; workoutId: string }> {
    const { workout } = dto;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const existing = await qr.manager.findOne(Workout, { where: { id: workout.id } });
      if (existing && existing.userId !== user.id) throw new Error('Workout does not belong to user');
      const existingExercises = await qr.manager.find(Exercise, { where: { workoutId: workout.id }, select: ['id'] });
      const exIds = existingExercises.map(e => e.id);
      if (exIds.length > 0) await qr.manager.createQueryBuilder().delete().from(Set).where('exercise_id IN (:...ids)', { ids: exIds }).execute();
      await qr.manager.createQueryBuilder().delete().from(Exercise).where('workout_id = :wid', { wid: workout.id }).execute();
      await qr.manager.createQueryBuilder().insert().into(Workout).values({ id: workout.id, userId: user.id, startedAt: new Date(workout.startedAt), endedAt: workout.endedAt ? new Date(workout.endedAt) : null }).orUpdate(['started_at', 'ended_at', 'updated_at'], ['id']).execute();
      if (workout.exercises.length > 0) {
        await qr.manager.createQueryBuilder().insert().into(Exercise).values(workout.exercises.map(ex => ({ id: ex.id, workoutId: workout.id, name: ex.name, orderIndex: ex.orderIndex }))).execute();
        const sets: { id: string; exerciseId: string; weight: number | null; reps: number | null; rpe: number | null; isWarmup: boolean }[] = [];
        workout.exercises.forEach(ex => ex.sets.forEach(s => sets.push({ id: s.id, exerciseId: ex.id, weight: s.weight, reps: s.reps, rpe: s.rpe, isWarmup: s.isWarmup })));
        if (sets.length > 0) await qr.manager.createQueryBuilder().insert().into(Set).values(sets).execute();
      }
      await qr.commitTransaction();
      return { success: true, workoutId: workout.id };
    } catch (e) { await qr.rollbackTransaction(); throw e; }
    finally { await qr.release(); }
  }
}
