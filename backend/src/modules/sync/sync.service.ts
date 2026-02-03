import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workout } from '../workouts/entities/workout.entity';
import { WorkoutExercise } from '../workouts/entities/workout-exercise.entity';
import { Set } from '../workouts/entities/set.entity';
import { User } from '../users/entities/user.entity';
import { SyncWorkoutDto } from './dto/sync-workout.dto';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(Workout) private workoutsRepo: Repository<Workout>,
    @InjectRepository(WorkoutExercise) private workoutExercisesRepo: Repository<WorkoutExercise>,
    @InjectRepository(Set) private setsRepo: Repository<Set>,
    private dataSource: DataSource
  ) {}

  async syncWorkout(dto: SyncWorkoutDto, user: User): Promise<{ success: boolean; workoutId: string }> {
    const { workout } = dto;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // Check if workout exists and belongs to user
      const existing = await qr.manager.findOne(Workout, { where: { id: workout.id } });
      if (existing && existing.userId !== user.id) {
        throw new Error('Workout does not belong to user');
      }

      // Delete existing workout exercises and sets
      const existingWorkoutExercises = await qr.manager.find(WorkoutExercise, {
        where: { workoutId: workout.id },
        select: ['id']
      });
      const weIds = existingWorkoutExercises.map(we => we.id);

      if (weIds.length > 0) {
        await qr.manager.createQueryBuilder()
          .delete()
          .from(Set)
          .where('workout_exercise_id IN (:...ids)', { ids: weIds })
          .execute();
      }

      await qr.manager.createQueryBuilder()
        .delete()
        .from(WorkoutExercise)
        .where('workout_id = :wid', { wid: workout.id })
        .execute();

      // Upsert workout
      await qr.manager.createQueryBuilder()
        .insert()
        .into(Workout)
        .values({
          id: workout.id,
          userId: user.id,
          name: workout.name || null,
          notes: workout.notes || null,
          startedAt: new Date(workout.startedAt),
          endedAt: workout.endedAt ? new Date(workout.endedAt) : null,
          durationSeconds: workout.durationSeconds || null
        })
        .orUpdate(['name', 'notes', 'started_at', 'ended_at', 'duration_seconds', 'updated_at'], ['id'])
        .execute();

      // Insert workout exercises and sets
      if (workout.exercises && workout.exercises.length > 0) {
        await qr.manager.createQueryBuilder()
          .insert()
          .into(WorkoutExercise)
          .values(workout.exercises.map(ex => ({
            id: ex.id,
            workoutId: workout.id,
            exerciseId: ex.exerciseId,
            orderIndex: ex.orderIndex,
            notes: ex.notes || null,
            restSeconds: ex.restSeconds || null
          })))
          .execute();

        const sets: Array<{
          id: string;
          workoutExerciseId: string;
          orderIndex: number;
          weight: number | null;
          reps: number | null;
          rpe: number | null;
          isWarmup: boolean;
          isDropset: boolean;
          isFailure: boolean;
          durationSeconds: number | null;
          distance: number | null;
        }> = [];

        workout.exercises.forEach(ex =>
          ex.sets.forEach(s =>
            sets.push({
              id: s.id,
              workoutExerciseId: ex.id,
              orderIndex: s.orderIndex || 0,
              weight: s.weight ?? null,
              reps: s.reps ?? null,
              rpe: s.rpe ?? null,
              isWarmup: s.isWarmup || false,
              isDropset: s.isDropset || false,
              isFailure: s.isFailure || false,
              durationSeconds: s.durationSeconds ?? null,
              distance: s.distance ?? null
            })
          )
        );

        if (sets.length > 0) {
          await qr.manager.createQueryBuilder()
            .insert()
            .into(Set)
            .values(sets)
            .execute();
        }
      }

      await qr.commitTransaction();
      return { success: true, workoutId: workout.id };
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }
}
