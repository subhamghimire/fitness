import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { WorkoutStat } from "./entities/workout-stat.entity";
import { WorkoutExerciseStat } from "./entities/workout-exercise-stat.entity";
import { ExerciseStat } from "./entities/exercise-stat.entity";
import { PersonalRecord } from "./entities/personal-record.entity";
import { PersonalRecordType, FrequencyGranularity } from "./enums/progress.enum";
import { createPaginatedResponse } from "src/common/dto";
import {
  OverviewQueryDto,
  ExerciseListQueryDto,
  ExerciseHistoryQueryDto,
  PersonalRecordsQueryDto,
  VolumeHistoryQueryDto,
  WorkoutFrequencyQueryDto
} from "./dto/progress-query.dto";
import {
  ProgressOverviewResponseDto,
  WorkoutFrequencyEntryDto,
  VolumeHistoryEntryDto,
  ExerciseStatResponseDto,
  PaginatedExerciseStatResponseDto,
  ExerciseHistoryEntryDto,
  PaginatedExerciseHistoryResponseDto,
  PersonalRecordResponseDto,
  PaginatedPersonalRecordResponseDto,
  ExerciseBestDto
} from "./dto/progress-response.dto";

/**
 * PROGRESS READ API
 *
 * Dashboard-facing reads. Every one of them aggregates over the materialized
 * projection tables (`workout_stats` = 1 row/workout, `exercise_stats`,
 * `workout_exercise_stats`, `personal_records`) — the app NEVER scans the
 * historical `sets` table on a dashboard request. Projection freshness is
 * maintained asynchronously by `ProgressProjectionService`; if the queue is
 * momentarily behind, the API simply reports the last consistent snapshot
 * (eventual consistency by design).
 */
@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(WorkoutStat) private readonly workoutStatsRepo: Repository<WorkoutStat>,
    @InjectRepository(WorkoutExerciseStat) private readonly weStatsRepo: Repository<WorkoutExerciseStat>,
    @InjectRepository(ExerciseStat) private readonly exerciseStatsRepo: Repository<ExerciseStat>,
    @InjectRepository(PersonalRecord) private readonly prRepo: Repository<PersonalRecord>
  ) {}

  // ─── Dashboard overview ───────────────────────────────────────────────────

  async overview(userId: string, query: OverviewQueryDto): Promise<ProgressOverviewResponseDto> {
    const total = await this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select("COUNT(*)", "totalWorkouts")
      .addSelect("COALESCE(SUM(ws.volumeKg), 0)", "totalVolumeKg")
      .addSelect("COALESCE(SUM(ws.reps), 0)", "totalReps")
      .addSelect("COALESCE(SUM(ws.durationSeconds), 0)", "totalDurationSeconds")
      .addSelect("COALESCE(AVG(ws.durationSeconds), 0)", "avgDurationSeconds")
      .addSelect('COUNT(DISTINCT (ws."started_at"::date))', "activeDays")
      .addSelect("MIN(ws.startedAt)", "firstWorkoutAt")
      .addSelect("MAX(ws.startedAt)", "lastWorkoutAt")
      .where("ws.userId = :userId", { userId })
      .getRawOne<{
        totalWorkouts: string;
        totalVolumeKg: string;
        totalReps: string;
        totalDurationSeconds: string;
        avgDurationSeconds: string;
        activeDays: string;
        firstWorkoutAt: Date | null;
        lastWorkoutAt: Date | null;
      }>();

    const weekly = await this.workoutFrequency(userId, {
      granularity: FrequencyGranularity.WEEK,
      periods: query.weeks,
      from: undefined,
      to: undefined
    });

    return {
      totalWorkouts: Number(total?.totalWorkouts ?? 0),
      totalVolumeKg: Number(total?.totalVolumeKg ?? 0),
      totalReps: Number(total?.totalReps ?? 0),
      totalDurationSeconds: Number(total?.totalDurationSeconds ?? 0),
      avgDurationSeconds: Number(total?.avgDurationSeconds ?? 0),
      activeDays: Number(total?.activeDays ?? 0),
      firstWorkoutAt: total?.firstWorkoutAt ?? null,
      lastWorkoutAt: total?.lastWorkoutAt ?? null,
      weeklyWorkoutFrequency: weekly
    };
  }

  // ─── Volume history / workout frequency series ────────────────────────────

  async volumeHistory(userId: string, query: VolumeHistoryQueryDto): Promise<VolumeHistoryEntryDto[]> {
    const bucketExpr = 'date_trunc(CAST(:granularity AS text), ws."started_at")';
    const qb = this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select(bucketExpr, "bucket")
      .addSelect("COUNT(*)", "workoutCount")
      .addSelect("COALESCE(SUM(ws.volumeKg), 0)", "volumeKg")
      .addSelect("COALESCE(SUM(ws.reps), 0)", "totalReps")
      .where("ws.userId = :userId", { userId })
      .setParameter("granularity", query.granularity)
      .groupBy(bucketExpr)
      .orderBy("bucket", "ASC");
    if (query.from) qb.andWhere("ws.startedAt >= :from", { from: query.from });
    if (query.to) qb.andWhere("ws.startedAt <= :to", { to: query.to });

    const rows = await qb.getRawMany<{ bucket: Date; workoutCount: string; volumeKg: string; totalReps: string }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      workoutCount: Number(r.workoutCount),
      volumeKg: Number(r.volumeKg),
      totalReps: Number(r.totalReps)
    }));
  }

  async workoutFrequency(userId: string, query: WorkoutFrequencyQueryDto): Promise<WorkoutFrequencyEntryDto[]> {
    const bucketExpr = 'date_trunc(CAST(:granularity AS text), ws."started_at")';
    const qb = this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select(bucketExpr, "bucket")
      .addSelect("COUNT(*)", "count")
      .where("ws.userId = :userId", { userId })
      .setParameter("granularity", query.granularity)
      .groupBy(bucketExpr)
      .orderBy("bucket", "DESC")
      .limit(query.periods);
    if (query.from) qb.andWhere("ws.startedAt >= :from", { from: query.from });
    if (query.to) qb.andWhere("ws.startedAt <= :to", { to: query.to });

    const rows = await qb.getRawMany<{ bucket: Date; count: string }>();

    return rows.reverse().map((r) => ({ bucket: r.bucket, count: Number(r.count) }));
  }

  // ─── Exercise list (bests + cumulative totals) ────────────────────────────

  async listExercises(userId: string, query: ExerciseListQueryDto): Promise<PaginatedExerciseStatResponseDto> {
    const { page = 1, limit = 10 } = query;
    const [stats, total] = await this.exerciseStatsRepo.findAndCount({
      where: { userId },
      order: { lastPerformedAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit
    });
    return createPaginatedResponse(
      stats.map((s) => this.toExerciseStatDto(s)),
      total,
      page,
      limit
    );
  }

  // ─── Exercise progression history ─────────────────────────────────────────

  async exerciseHistory(userId: string, exerciseId: string, query: ExerciseHistoryQueryDto): Promise<PaginatedExerciseHistoryResponseDto> {
    const { page = 1, limit = 20 } = query;
    const qb = this.weStatsRepo.createQueryBuilder("wes").where("wes.userId = :userId", { userId }).andWhere("wes.exerciseId = :exerciseId", { exerciseId });
    if (query.from) qb.andWhere("wes.startedAt >= :from", { from: query.from });
    if (query.to) qb.andWhere("wes.startedAt <= :to", { to: query.to });
    qb.orderBy("wes.startedAt", "DESC").addOrderBy("wes.workoutId", "DESC");

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const stats = await qb.getMany();

    const workoutIds = [...new Set(stats.map((s) => s.workoutId))];
    const names = new Map<string, string | null>();
    if (workoutIds.length > 0) {
      const workouts = await this.workoutStatsRepo.find({ where: { workoutId: In(workoutIds), userId } });
      for (const w of workouts) names.set(w.workoutId, w.name);
    }

    const entries: ExerciseHistoryEntryDto[] = stats.map((s) => ({
      workoutId: s.workoutId,
      workoutExerciseId: s.workoutExerciseId,
      workoutName: names.get(s.workoutId) ?? null,
      name: s.name,
      startedAt: s.startedAt,
      setCount: s.setCount,
      reps: s.reps,
      volumeKg: s.volumeKg,
      bestWeightKg: s.bestWeightKg,
      bestReps: s.bestReps,
      bestEstimated1RmKg: s.bestEstimated1RmKg,
      bestDistanceM: s.bestDistanceM,
      bestTimeSeconds: s.bestTimeSeconds
    }));

    return createPaginatedResponse(entries, total, page, limit);
  }

  // ─── Personal records ─────────────────────────────────────────────────────

  async listPersonalRecords(userId: string, query: PersonalRecordsQueryDto): Promise<PaginatedPersonalRecordResponseDto> {
    const { page = 1, limit = 20, prType, exerciseId } = query;
    const where: Record<string, unknown> = { userId };
    if (prType) where.prType = prType;
    if (exerciseId) where.exerciseId = exerciseId;

    const [records, total] = await this.prRepo.findAndCount({
      where,
      order: { achievedAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit
    });

    const exerciseIds = [...new Set(records.map((r) => r.exerciseId).filter((x): x is string => Boolean(x)))];
    const statMap = new Map<string, ExerciseStat>();
    if (exerciseIds.length > 0) {
      const stats = await this.exerciseStatsRepo.find({ where: { userId, exerciseId: In(exerciseIds) } });
      for (const s of stats) statMap.set(s.exerciseId, s);
    }

    const dtos: PersonalRecordResponseDto[] = records.map((r) => ({
      prType: r.prType,
      value: r.value,
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      workoutId: r.workoutId,
      workoutExerciseId: r.workoutExerciseId,
      achievedAt: r.achievedAt,
      isCurrent: this.isCurrentRecord(r, statMap.get(r.exerciseId ?? ""))
    }));

    return createPaginatedResponse(dtos, total, page, limit);
  }

  private isCurrentRecord(record: PersonalRecord, stat: ExerciseStat | undefined): boolean {
    if (!stat) return false;
    const [workoutId, workoutExerciseId] = this.recordRef(stat, record.prType);
    return workoutId === record.workoutId && workoutExerciseId === record.workoutExerciseId;
  }

  private recordRef(stat: ExerciseStat, type: PersonalRecordType): [string | null, string | null] {
    switch (type) {
      case PersonalRecordType.BEST_WEIGHT_KG:
        return [stat.bestWeightWorkoutId, stat.bestWeightWorkoutExerciseId];
      case PersonalRecordType.BEST_REPS:
        return [stat.bestRepsWorkoutId, stat.bestRepsWorkoutExerciseId];
      case PersonalRecordType.BEST_VOLUME_KG:
        return [stat.bestVolumeWorkoutId, stat.bestVolumeWorkoutExerciseId];
      case PersonalRecordType.BEST_ESTIMATED_1RM_KG:
        return [stat.best1RmWorkoutId, stat.best1RmWorkoutExerciseId];
      case PersonalRecordType.BEST_DISTANCE_M:
        return [stat.bestDistanceWorkoutId, stat.bestDistanceWorkoutExerciseId];
      case PersonalRecordType.BEST_TIME_SECONDS:
        return [stat.bestTimeWorkoutId, stat.bestTimeWorkoutExerciseId];
      default:
        return [null, null];
    }
  }

  // ─── Response mapping ─────────────────────────────────────────────────────

  private toExerciseStatDto(stat: ExerciseStat): ExerciseStatResponseDto {
    return {
      exerciseId: stat.exerciseId,
      exerciseName: stat.exerciseName,
      workoutCount: stat.workoutCount,
      totalVolumeKg: stat.totalVolumeKg,
      totalReps: stat.totalReps,
      firstPerformedAt: stat.firstPerformedAt,
      lastPerformedAt: stat.lastPerformedAt,
      bestWeightKg: this.best(stat.bestWeightKg, stat.bestWeightWorkoutId, stat.bestWeightWorkoutExerciseId, stat.bestWeightAt),
      bestReps: this.best(stat.bestReps, stat.bestRepsWorkoutId, stat.bestRepsWorkoutExerciseId, stat.bestRepsAt),
      bestVolumeKg: this.best(stat.bestVolumeKg, stat.bestVolumeWorkoutId, stat.bestVolumeWorkoutExerciseId, stat.bestVolumeAt),
      bestEstimated1RmKg: this.best(stat.bestEstimated1RmKg, stat.best1RmWorkoutId, stat.best1RmWorkoutExerciseId, stat.best1RmAt),
      bestDistanceM: this.best(stat.bestDistanceM, stat.bestDistanceWorkoutId, stat.bestDistanceWorkoutExerciseId, stat.bestDistanceAt),
      bestTimeSeconds: this.best(stat.bestTimeSeconds, stat.bestTimeWorkoutId, stat.bestTimeWorkoutExerciseId, stat.bestTimeAt)
    };
  }

  private best(value: number | null, workoutId: string | null, workoutExerciseId: string | null, achievedAt: Date | null): ExerciseBestDto {
    if (value == null) {
      return { value: null, workoutId: null, workoutExerciseId: null, achievedAt: null };
    }
    return { value, workoutId, workoutExerciseId, achievedAt };
  }
}
