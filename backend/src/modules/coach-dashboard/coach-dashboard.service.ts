import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository, SelectQueryBuilder } from "typeorm";
import { TtlCache } from "src/common/cache/ttl-cache";
import { createPaginatedResponse } from "src/common/dto";
import { CoachClientRelationship } from "src/modules/coach-client/entities/coach-client-relationship.entity";
import { RelationshipStatus } from "src/modules/coach-client/enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Program } from "src/modules/program/entities/program.entity";
import { ProgramAssignment } from "src/modules/program/entities/program-assignment.entity";
import { ProgramDay } from "src/modules/program/entities/program-day.entity";
import { ProgramWorkout } from "src/modules/program/entities/program-workout.entity";
import { ProgramAssignmentStatus } from "src/modules/program/enums/program.enum";
import { WorkoutStat } from "src/modules/progress/entities/workout-stat.entity";
import { WorkoutExerciseStat } from "src/modules/progress/entities/workout-exercise-stat.entity";
import { ExerciseStat } from "src/modules/progress/entities/exercise-stat.entity";
import { PersonalRecord } from "src/modules/progress/entities/personal-record.entity";
import { FrequencyGranularity, VolumeGranularity } from "src/modules/progress/enums/progress.enum";
import { ProgressService } from "src/modules/progress/progress.service";
import { CoachDashboardQueryDto, CoachClientListQueryDto, CoachClientDetailQueryDto, CoachActivityQueryDto } from "./dto/coach-dashboard-query.dto";
import {
  ClientActivityEntryDto,
  ClientProgressDetailDto,
  ClientProgressSummaryDto,
  CoachDashboardOverviewResponseDto,
  ExerciseProgressionDto,
  ExerciseSessionSnapshotDto,
  MissedWorkoutDto,
  PaginatedClientActivityResponseDto,
  PaginatedClientProgressSummaryResponseDto,
  PendingRequestDto,
  ProgramProgressOverviewDto,
  ProgramProgressSummaryDto,
  ProgressTrendEntryDto,
  RecentPrDto,
  RecentWorkoutDto,
  WorkoutAdherenceDto
} from "./dto/coach-dashboard-response.dto";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_WINDOW_DAYS = 28;
const DEFAULT_TREND_WEEKS = 12;
const DEFAULT_RECENT_LIMIT = 5;
const DEFAULT_WINDOW_CAP = 90;
const ACTIVITY_WINDOW_CAP = 365;
const OVERVIEW_TTL_MS = 30_000;
const LIST_TTL_MS = 15_000;
const OVERVIEW_CLIENT_PREVIEW = 5;
const FEED_PREVIEW = 6;
const TREND_CAP_WEEKS = 52;
const PROGRESSION_TOP_EXERCISES = 5;
const PROGRESSION_SESSION_CAP = 50;

/** Relationship statuses a coach can see on their dashboard. */
const LIVE_STATUSES = [RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED];

interface ScoutWindow {
  days: number;
  start: Date;
  today: Date;
}

interface ClientStatAgg {
  workoutCount: number;
  volumeKg: number;
  reps: number;
  setCount: number;
  activeDays: number;
  lastWorkoutAt: Date | null;
}

interface LiveRelation {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  status: RelationshipStatus;
  startedAt: Date | null;
}

interface BundleRelations {
  day: ProgramDay;
  scheduledDate: Date;
  workouts: ProgramWorkout[];
}

interface AssignmentMetrics {
  expectedTrainingDays: number;
  completedTrainingDays: number;
  missedWorkouts: number;
  missedDetails: MissedWorkoutDto[];
  primarySummary: ProgramProgressSummaryDto;
}

interface ActivityRow {
  workoutId: string;
  clientId: string;
  clientName: string;
  name: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  volumeKg: string | number;
  reps: string | number;
  setCount: string | number;
  exerciseCount: string | number;
}

interface StatRow {
  userId: string;
  workoutCount: string | number;
  volumeKg: string | number;
  reps: string | number;
  setCount: string | number;
  activeDays: string | number;
  lastWorkoutAt: Date | null;
}

/**
 * COACH DASHBOARD READ API
 *
 * Purpose-built aggregate queries for the coach dashboard. Design rules:
 *
 *   • PRIVACY — every entry point is rooted in the coach's own profile and the
 *     coach-client relationship. Accessing a client the coach is not attached
 *     to (or whose relationship is not live) is an anonymous 404, matching the
 *     project-wide "outsiders cannot probe existence" strategy.
 *   • NO N+1 — cross-client rollups run on the materialized projections
 *     (`workout_stats`, `personal_records`, `exercise_stats`) using ONE GROUP BY
 *     query per metric instead of per-client queries. Program schedule data is
 *     loaded with a fixed set of IN-loaded queries, never per client.
 *   • COLUMN NARROWING — raw selects pick only the columns each response needs.
 *   • CACHING — the two aggregate endpoints (overview + client list) are cached
 *     for a short TTL because dashboards poll them aggressively and tolerate a
 *     few seconds of staleness. Single-client reads are never cached.
 *
 * All dashboard metrics are scoped to a trailing window (default 28 days) so
 * every number is comparable and the query set stays bounded.
 */
@Injectable()
export class CoachDashboardService {
  private readonly overviewCache: TtlCache<CoachDashboardOverviewResponseDto>;
  private readonly listCache: TtlCache<PaginatedClientProgressSummaryResponseDto>;

  constructor(
    @InjectRepository(CoachClientRelationship) private readonly relationshipRepo: Repository<CoachClientRelationship>,
    @InjectRepository(Coach) private readonly coachRepo: Repository<Coach>,
    @InjectRepository(Program) private readonly programRepo: Repository<Program>,
    @InjectRepository(ProgramAssignment) private readonly assignmentRepo: Repository<ProgramAssignment>,
    @InjectRepository(ProgramDay) private readonly dayRepo: Repository<ProgramDay>,
    @InjectRepository(ProgramWorkout) private readonly workoutRepo: Repository<ProgramWorkout>,
    @InjectRepository(WorkoutStat) private readonly workoutStatsRepo: Repository<WorkoutStat>,
    @InjectRepository(PersonalRecord) private readonly prRepo: Repository<PersonalRecord>,
    @InjectRepository(ExerciseStat) private readonly exerciseStatsRepo: Repository<ExerciseStat>,
    @InjectRepository(WorkoutExerciseStat) private readonly weStatsRepo: Repository<WorkoutExerciseStat>,
    private readonly progressService: ProgressService
  ) {
    this.overviewCache = new TtlCache(OVERVIEW_TTL_MS);
    this.listCache = new TtlCache(LIST_TTL_MS);
  }

  // ─── Public entry points ─────────────────────────────────────────────────

  async overview(user: User, query: CoachDashboardQueryDto): Promise<CoachDashboardOverviewResponseDto> {
    const coach = await this.requireCoach(user);
    const window = this.resolveWindow(query.windowDays, DEFAULT_WINDOW_CAP, DEFAULT_WINDOW_DAYS);
    const weeks = this.resolveWeeks(query.weeks);

    const cacheKey = `overview:${coach.id}:${window.days}:${weeks}`;
    const cached = this.overviewCache.get(cacheKey);
    if (cached) return cached;

    const result = await this.buildOverview(coach.id, window, weeks);
    this.overviewCache.set(cacheKey, result);
    return result;
  }

  async clientSummaries(user: User, query: CoachClientListQueryDto): Promise<PaginatedClientProgressSummaryResponseDto> {
    const coach = await this.requireCoach(user);
    const window = this.resolveWindow(query.windowDays, DEFAULT_WINDOW_CAP, DEFAULT_WINDOW_DAYS);
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);

    const cacheKey = `clients:${coach.id}:${page}:${limit}:${window.days}`;
    const cached = this.listCache.get(cacheKey);
    if (cached) return cached;

    const qb = this.liveRelationshipsQuery(coach.id);
    const total = await qb.getCount();
    const relationships = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getRawMany<LiveRelation>();
    const summaries = await this.summariesFor(relationships, coach.id, window);

    const result = createPaginatedResponse(summaries, total, page, limit);
    this.listCache.set(cacheKey, result);
    return result;
  }

  /** Full progress summary for a single client the coach is authorized to see. */
  async clientDetail(user: User, clientId: string, query: CoachClientDetailQueryDto): Promise<ClientProgressDetailDto> {
    const coach = await this.requireCoach(user);
    const relationship = await this.findLiveRelationship(coach.id, clientId);
    const window = this.resolveWindow(query.windowDays, DEFAULT_WINDOW_CAP, DEFAULT_WINDOW_DAYS);
    const weeks = this.resolveWeeks(query.weeks);
    const recentLimit = this.resolveRecentLimit(query.recentLimit);

    const clientIdKey = relationship.clientId;
    const [windowStatsRows, , workoutDayRows, , recentWorkouts, exerciseProgression] = await Promise.all([
      this.groupedWindowStats([clientIdKey], window.start),
      this.groupedTotalStats([clientIdKey]),
      this.workoutDayKeys([clientIdKey], window.start),
      this.prCountsForClients([clientIdKey], window.start),
      this.clientRecentWorkouts(clientIdKey, recentLimit),
      this.exerciseProgression(clientIdKey, recentLimit)
    ]);

    const windowStats = windowStatsRows.get(clientIdKey);

    const metrics = await this.assignmentMetrics(coach.id, [clientIdKey], window, workoutDayRows, windowStatsRows);
    const clientMetrics = metrics.get(clientIdKey);
    const finalAdherence = this.computeAdherence(windowStats?.activeDays ?? 0, clientMetrics, window, relationship.startedAt);

    const [overviewRes, volumeHistory, frequency, recentPrs] = await Promise.all([
      this.progressService.overview(clientIdKey, { weeks }),
      this.progressService.volumeHistory(clientIdKey, { granularity: VolumeGranularity.WEEK, from: new Date(Date.now() - weeks * WEEK_MS) }),
      this.progressService.workoutFrequency(clientIdKey, { granularity: FrequencyGranularity.WEEK, periods: weeks }),
      this.progressService.listPersonalRecords(clientIdKey, { page: 1, limit: recentLimit })
    ]);

    const progressTrends: ProgressTrendEntryDto[] = volumeHistory.map((v) => ({
      bucket: v.bucket,
      workoutCount: v.workoutCount,
      volumeKg: v.volumeKg
    }));

    return {
      client: { id: clientIdKey, name: relationship.clientName, email: relationship.clientEmail },
      relationship: { id: relationship.id, status: relationship.status, startedAt: relationship.startedAt },
      overview: overviewRes,
      workoutAdherence: finalAdherence,
      missedWorkouts: clientMetrics?.missedWorkouts ?? 0,
      programProgress: clientMetrics?.primarySummary ?? null,
      recentWorkouts,
      recentPersonalRecords: recentPrs.data,
      progressTrends,
      weeklyFrequency: frequency,
      exerciseProgression,
      missedWorkoutDetails: clientMetrics?.missedDetails ?? []
    };
  }

  async activity(user: User, query: CoachActivityQueryDto): Promise<PaginatedClientActivityResponseDto> {
    const coach = await this.requireCoach(user);
    const window = this.resolveWindow(query.windowDays, ACTIVITY_WINDOW_CAP, 90);
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);

    const qb = this.coachActivityQuery(coach.id).andWhere("ws.startedAt >= :windowStart", { windowStart: window.start });
    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const rows = await qb.getRawMany<ActivityRow>();

    return createPaginatedResponse(
      rows.map((r) => this.toActivityEntry(r)),
      total,
      page,
      limit
    );
  }

  // ─── Overview assembly ───────────────────────────────────────────────────

  private async buildOverview(coachId: string, window: ScoutWindow, weeks: number): Promise<CoachDashboardOverviewResponseDto> {
    const [statuses, relationships] = await Promise.all([this.statusCounts(coachId), this.liveRelationshipsQuery(coachId).getRawMany<LiveRelation>()]);

    const [windowStats, totals, workoutDays, prCounts] = await Promise.all([
      this.groupedWindowStatsCte(coachId, window.start),
      this.groupedTotalStatsCte(coachId),
      this.coachWorkoutDays(coachId, window.start),
      this.prCountsCte(coachId, window.start)
    ]);

    const metrics = await this.assignmentMetrics(
      coachId,
      relationships.map((r) => r.clientId),
      window,
      workoutDays,
      windowStats
    );

    const summaries = relationships.map((r) =>
      this.buildSummary(r, window, windowStats.get(r.clientId), totals.get(r.clientId), metrics.get(r.clientId), prCounts.get(r.clientId) ?? 0)
    );

    const [pendingRequests, recentClientWorkouts, recentPersonalRecords, trends] = await Promise.all([
      this.pendingRequests(coachId),
      this.coachRecentWorkouts(coachId, FEED_PREVIEW),
      this.coachRecentPrs(coachId, FEED_PREVIEW),
      this.coachTrends(coachId, weeks)
    ]);

    const activeCount = relationships.filter((r) => r.status === RelationshipStatus.ACTIVE).length;
    const pausedClientCount = relationships.length - activeCount;
    const pendingRequestCount = statuses.get(RelationshipStatus.PENDING) ?? 0;

    return {
      activeClientCount: activeCount,
      pausedClientCount,
      pendingRequestCount,
      activeClients: summaries.slice(0, OVERVIEW_CLIENT_PREVIEW),
      pendingRequests,
      recentClientWorkouts,
      workoutAdherence: this.aggregateAdherence(summaries),
      programProgress: this.aggregateProgramProgress(metrics),
      recentPersonalRecords,
      progressTrends: trends
    };
  }

  private async summariesFor(relationships: LiveRelation[], coachId: string, window: ScoutWindow): Promise<ClientProgressSummaryDto[]> {
    const clientIds = relationships.map((r) => r.clientId);
    if (clientIds.length === 0) return [];

    const [windowStats, totals, workoutDays, prCounts] = await Promise.all([
      this.groupedWindowStats(clientIds, window.start),
      this.groupedTotalStats(clientIds),
      this.workoutDayKeys(clientIds, window.start),
      this.prCountsForClients(clientIds, window.start)
    ]);

    const metrics = await this.assignmentMetrics(coachId, clientIds, window, workoutDays, windowStats);
    return relationships.map((r) => this.buildSummary(r, window, windowStats.get(r.clientId), totals.get(r.clientId), metrics.get(r.clientId), prCounts.get(r.clientId) ?? 0));
  }

  private buildSummary(
    rel: LiveRelation,
    window: ScoutWindow,
    windowStats: ClientStatAgg | undefined,
    totals: ClientStatAgg | undefined,
    metrics: AssignmentMetrics | undefined,
    recentPrCount: number
  ): ClientProgressSummaryDto {
    const adherence = this.computeAdherence(windowStats?.activeDays ?? 0, metrics, window, rel.startedAt);
    return {
      client: { id: rel.clientId, name: rel.clientName, email: rel.clientEmail },
      relationship: { id: rel.id, status: rel.status, startedAt: rel.startedAt },
      lastWorkoutAt: totals?.lastWorkoutAt ?? null,
      workoutCountInWindow: windowStats?.workoutCount ?? 0,
      totalWorkoutCount: totals?.workoutCount ?? 0,
      workoutAdherence: adherence,
      missedWorkouts: metrics?.missedWorkouts ?? 0,
      programProgress: metrics?.primarySummary ?? null,
      recentPrCount
    };
  }

  private computeAdherence(activeDays: number, metrics: AssignmentMetrics | undefined, window: ScoutWindow, startedAt: Date | null): WorkoutAdherenceDto {
    const programBasis = metrics !== undefined && metrics.expectedTrainingDays > 0;
    const expected = programBasis ? metrics.expectedTrainingDays : this.windowBasisDays(window, startedAt);
    const completed = programBasis ? metrics.completedTrainingDays : activeDays;
    return {
      completedTrainingDays: completed,
      expectedTrainingDays: expected,
      adherence: expected > 0 ? Math.min(1, completed / expected) : null,
      windowDays: window.days
    };
  }

  /**
   * Trailing-window denominator for clients without a program, clamped to how
   * long the relationship has actually been live so brand-new clients are not
   * judged against a full 28-day window.
   */
  private windowBasisDays(window: ScoutWindow, startedAt: Date | null): number {
    if (!startedAt) return window.days;
    const elapsed = Math.ceil((window.today.getTime() - startedAt.getTime()) / DAY_MS);
    return Math.max(1, Math.min(window.days, elapsed));
  }

  private aggregateAdherence(summaries: ClientProgressSummaryDto[]): WorkoutAdherenceDto | null {
    if (summaries.length === 0) return null;
    const expected = summaries.reduce((acc, s) => acc + s.workoutAdherence.expectedTrainingDays, 0);
    const completed = summaries.reduce((acc, s) => acc + s.workoutAdherence.completedTrainingDays, 0);
    return {
      completedTrainingDays: completed,
      expectedTrainingDays: expected,
      adherence: expected > 0 ? Math.min(1, completed / expected) : null,
      windowDays: summaries[0].workoutAdherence.windowDays
    };
  }

  private aggregateProgramProgress(metricsByClient: Map<string, AssignmentMetrics>): ProgramProgressOverviewDto {
    const summaries: ProgramProgressSummaryDto[] = [...metricsByClient.values()].map((m) => m.primarySummary);
    const activeAssignments = summaries.length;
    const scheduledWorkouts = summaries.reduce((acc, s) => acc + s.scheduledWorkouts, 0);
    const completedWorkouts = summaries.reduce((acc, s) => acc + s.completedWorkouts, 0);
    const missedWorkouts = summaries.reduce((acc, s) => acc + s.missedWorkouts, 0);
    return {
      activeAssignments,
      scheduledWorkouts,
      completedWorkouts,
      missedWorkouts,
      percentComplete: scheduledWorkouts > 0 ? Math.round((completedWorkouts / scheduledWorkouts) * 100) : 0
    };
  }

  // ─── Relationship queries (privacy scope) ────────────────────────────────

  private liveRelationshipsQuery(coachId: string) {
    return this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.id", "id")
      .addSelect("cc.status", "status")
      .addSelect("cc.startedAt", "startedAt")
      .addSelect("cc.clientId", "clientId")
      .addSelect("u.id", "clientUserId")
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .orderBy("cc.startedAt", "DESC");
  }

  private async statusCounts(coachId: string): Promise<Map<RelationshipStatus, number>> {
    const rows = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .groupBy("cc.status")
      .getRawMany<{ status: RelationshipStatus; count: string }>();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  private async pendingRequests(coachId: string): Promise<PendingRequestDto[]> {
    const rows = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.id", "relationshipId")
      .addSelect("cc.createdAt", "createdAt")
      .addSelect("cc.clientId", "clientId")
      .addSelect("u.id", "clientUserId")
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status = :status", { status: RelationshipStatus.PENDING })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .orderBy("cc.createdAt", "DESC")
      .getRawMany<{
        relationshipId: string;
        createdAt: Date;
        clientId: string;
        clientUserId: string;
        clientName: string;
        clientEmail: string;
      }>();
    return rows.map((r) => ({
      relationshipId: r.relationshipId,
      createdAt: r.createdAt,
      client: { id: r.clientId, name: r.clientName, email: r.clientEmail }
    }));
  }

  /** Privacy gate: only live relationships are visible to the coach. */
  private async findLiveRelationship(coachId: string, clientId: string): Promise<LiveRelation> {
    const row = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.id", "id")
      .addSelect("cc.status", "status")
      .addSelect("cc.startedAt", "startedAt")
      .addSelect("cc.clientId", "clientId")
      .addSelect("u.id", "clientUserId")
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.clientId = :clientId", { clientId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .orderBy("cc.startedAt", "DESC")
      .addOrderBy("cc.createdAt", "DESC")
      .getRawOne<LiveRelation>();
    if (!row) {
      throw new NotFoundException("Client not found");
    }
    return row;
  }

  // ─── Cross-client rollups on the materialized projections ────────────────

  /** CTE selecting the live client ids for a coach (single source of scope). */
  private liveClientCte(coachId: string) {
    return this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.clientId", "client_id")
      .addSelect("u.name", "client_name")
      .distinctOn(["cc.clientId"])
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false });
  }

  private scopedByLiveClients(qb: SelectQueryBuilder<WorkoutStat>, coachId: string): SelectQueryBuilder<WorkoutStat> {
    const cte = this.liveClientCte(coachId);
    qb.addCommonTableExpression(cte, "coach_live_clients");
    qb.andWhere("ws.userId IN (SELECT clc.client_id FROM coach_live_clients clc)");
    return qb;
  }

  private groupedWindowStatsCte(coachId: string, from: Date): Promise<Map<string, ClientStatAgg>> {
    const qb = this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId);
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb.andWhere("ws.startedAt >= :from", { from }));
  }

  private groupedTotalStatsCte(coachId: string): Promise<Map<string, ClientStatAgg>> {
    const qb = this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId);
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb);
  }

  private groupedWindowStats(clientIds: string[], from: Date): Promise<Map<string, ClientStatAgg>> {
    const qb = this.workoutStatsRepo.createQueryBuilder("ws");
    qb.where("ws.userId IN (:...clientIds)", { clientIds }).andWhere("ws.startedAt >= :from", { from });
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb);
  }

  private groupedTotalStats(clientIds: string[]): Promise<Map<string, ClientStatAgg>> {
    const qb = this.workoutStatsRepo.createQueryBuilder("ws");
    qb.where("ws.userId IN (:...clientIds)", { clientIds });
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb);
  }

  private executeGroupedStats(qb: SelectQueryBuilder<WorkoutStat>): Promise<Map<string, ClientStatAgg>> {
    return qb.getRawMany<StatRow>().then((rows) => {
      const map = new Map<string, ClientStatAgg>();
      for (const r of rows) {
        map.set(r.userId, {
          workoutCount: this.num(r.workoutCount),
          volumeKg: this.num(r.volumeKg),
          reps: this.num(r.reps),
          setCount: this.num(r.setCount),
          activeDays: this.num(r.activeDays),
          lastWorkoutAt: r.lastWorkoutAt ?? null
        });
      }
      return map;
    });
  }

  private groupedStatsSelect(qb: SelectQueryBuilder<WorkoutStat>): SelectQueryBuilder<WorkoutStat> {
    return qb
      .select("ws.userId", "userId")
      .addSelect("COUNT(*)", "workoutCount")
      .addSelect("COALESCE(SUM(ws.volumeKg), 0)", "volumeKg")
      .addSelect("COALESCE(SUM(ws.reps), 0)", "reps")
      .addSelect("COALESCE(SUM(ws.setCount), 0)", "setCount")
      .addSelect("COUNT(DISTINCT to_char(ws.startedAt, 'YYYY-MM-DD'))", "activeDays")
      .addSelect("MAX(ws.startedAt)", "lastWorkoutAt")
      .groupBy("ws.userId");
  }

  /** Distinct (client, calendar day) pairs for the window — one bounded query. */
  private async workoutDayKeys(clientIds: string[], from: Date): Promise<Map<string, Set<string>>> {
    if (clientIds.length === 0) return new Map();
    const qb = this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select("ws.userId", "userId")
      .addSelect("to_char(ws.startedAt, 'YYYY-MM-DD')", "day")
      .where("ws.userId IN (:...clientIds)", { clientIds })
      .andWhere("ws.startedAt >= :from", { from })
      .groupBy("ws.userId")
      .addGroupBy("to_char(ws.startedAt, 'YYYY-MM-DD')");
    const rows = await qb.getRawMany<{ userId: string; day: string }>();
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = map.get(r.userId) ?? new Set<string>();
      set.add(r.day);
      map.set(r.userId, set);
    }
    return map;
  }

  private async coachWorkoutDays(coachId: string, from: Date): Promise<Map<string, Set<string>>> {
    const qb = this.workoutStatsRepo.createQueryBuilder("ws");
    this.scopedByLiveClients(qb, coachId);
    qb.select("ws.userId", "userId")
      .addSelect("to_char(ws.startedAt, 'YYYY-MM-DD')", "day")
      .andWhere("ws.startedAt >= :from", { from })
      .groupBy("ws.userId")
      .addGroupBy("to_char(ws.startedAt, 'YYYY-MM-DD')");
    const rows = await qb.getRawMany<{ userId: string; day: string }>();
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = map.get(r.userId) ?? new Set<string>();
      set.add(r.day);
      map.set(r.userId, set);
    }
    return map;
  }

  private async prCountsCte(coachId: string, from: Date): Promise<Map<string, number>> {
    const qb = this.prRepo.createQueryBuilder("pr");
    const cte = this.liveClientCte(coachId);
    qb.select("pr.userId", "userId")
      .addSelect("COUNT(*)", "count")
      .addCommonTableExpression(cte, "coach_live_clients")
      .where("pr.userId IN (SELECT clc.client_id FROM coach_live_clients clc)")
      .andWhere("pr.achievedAt >= :from", { from })
      .groupBy("pr.userId");
    const rows = await qb.getRawMany<{ userId: string; count: string }>();
    return new Map(rows.map((r) => [r.userId, Number(r.count)]));
  }

  private async prCountsForClients(clientIds: string[], from: Date): Promise<Map<string, number>> {
    if (clientIds.length === 0) return new Map();
    const qb = this.prRepo
      .createQueryBuilder("pr")
      .select("pr.userId", "userId")
      .addSelect("COUNT(*)", "count")
      .where("pr.userId IN (:...clientIds)", { clientIds })
      .andWhere("pr.achievedAt >= :from", { from })
      .groupBy("pr.userId");
    const rows = await qb.getRawMany<{ userId: string; count: string }>();
    return new Map(rows.map((r) => [r.userId, Number(r.count)]));
  }

  private coachActivityQuery(coachId: string) {
    const ct = this.liveClientCte(coachId);
    return this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select("ws.workoutId", "workoutId")
      .addSelect("ws.userId", "clientId")
      .addSelect("ws.name", "name")
      .addSelect("ws.startedAt", "startedAt")
      .addSelect("ws.durationSeconds", "durationSeconds")
      .addSelect("ws.volumeKg", "volumeKg")
      .addSelect("ws.reps", "reps")
      .addSelect("ws.setCount", "setCount")
      .addSelect("ws.exerciseCount", "exerciseCount")
      .addSelect("u.name", "clientName")
      .innerJoin(CoachClientRelationship, "cc", "cc.client_id = ws.user_id AND cc.isDeleted = false AND cc.coach_id = :coachId", { coachId })
      .innerJoin(User, "u", "u.id = ws.user_id")
      .addCommonTableExpression(ct, "coach_live_clients")
      .where("ws.userId IN (SELECT clc.client_id FROM coach_live_clients clc) AND cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .orderBy("ws.startedAt", "DESC");
  }

  private async coachRecentWorkouts(coachId: string, limit: number): Promise<ClientActivityEntryDto[]> {
    const rows = await this.coachActivityQuery(coachId).limit(limit).getRawMany<ActivityRow>();
    return rows.map((r) => this.toActivityEntry(r));
  }

  private async coachRecentPrs(coachId: string, limit: number): Promise<RecentPrDto[]> {
    const cte = this.liveClientCte(coachId);
    const rows = await this.prRepo
      .createQueryBuilder("pr")
      .select("pr.prType", "prType")
      .addSelect("pr.value", "value")
      .addSelect("pr.exerciseId", "exerciseId")
      .addSelect("pr.exerciseName", "exerciseName")
      .addSelect("pr.workoutId", "workoutId")
      .addSelect("pr.workoutExerciseId", "workoutExerciseId")
      .addSelect("pr.achievedAt", "achievedAt")
      .addCommonTableExpression(cte, "coach_live_clients")
      .where("pr.userId IN (SELECT clc.client_id FROM coach_live_clients clc)")
      .orderBy("pr.achievedAt", "DESC")
      .limit(limit)
      .getRawMany<RecentPrDto & { workoutExerciseId: string }>();
    return rows.map((r) => ({
      prType: r.prType,
      value: Number(r.value),
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      workoutId: r.workoutId,
      achievedAt: r.achievedAt
    }));
  }

  private async coachTrends(coachId: string, weeks: number): Promise<ProgressTrendEntryDto[]> {
    const cte = this.liveClientCte(coachId);
    const trendStart = new Date(Date.now() - weeks * WEEK_MS);
    const rows = await this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select("date_trunc('week', ws.startedAt)", "bucket")
      .addSelect("COUNT(*)", "workoutCount")
      .addSelect("COALESCE(SUM(ws.volumeKg), 0)", "volumeKg")
      .addCommonTableExpression(cte, "coach_live_clients")
      .where("ws.userId IN (SELECT clc.client_id FROM coach_live_clients clc)")
      .andWhere("ws.startedAt >= :trendStart", { trendStart })
      .groupBy("bucket")
      .orderBy("bucket", "ASC")
      .getRawMany<{ bucket: Date; workoutCount: string; volumeKg: string }>();
    return rows.map((r) => ({ bucket: r.bucket, workoutCount: Number(r.workoutCount), volumeKg: Number(r.volumeKg) }));
  }

  // ─── Single-client queries ───────────────────────────────────────────────

  private async clientRecentWorkouts(clientId: string, limit: number): Promise<RecentWorkoutDto[]> {
    const rows = await this.workoutStatsRepo
      .createQueryBuilder("ws")
      .select("ws.workoutId", "workoutId")
      .addSelect("ws.name", "name")
      .addSelect("ws.startedAt", "startedAt")
      .addSelect("ws.durationSeconds", "durationSeconds")
      .addSelect("ws.volumeKg", "volumeKg")
      .addSelect("ws.reps", "reps")
      .addSelect("ws.setCount", "setCount")
      .addSelect("ws.exerciseCount", "exerciseCount")
      .where("ws.userId = :clientId", { clientId })
      .orderBy("ws.startedAt", "DESC")
      .limit(limit)
      .getRawMany<RecentWorkoutDto & { volumeKg: string | number; reps: string | number; setCount: string | number; exerciseCount: string | number }>();
    return rows.map((r) => ({
      workoutId: r.workoutId,
      name: r.name,
      startedAt: r.startedAt,
      durationSeconds: r.durationSeconds,
      volumeKg: this.num(r.volumeKg),
      reps: this.num(r.reps),
      setCount: this.num(r.setCount),
      exerciseCount: this.num(r.exerciseCount)
    }));
  }

  private async exerciseProgression(clientId: string, recentLimit: number): Promise<ExerciseProgressionDto[]> {
    const top = await this.exerciseStatsRepo
      .createQueryBuilder("es")
      .select(["es.exerciseId", "es.exerciseName", "es.workoutCount", "es.totalVolumeKg", "es.lastPerformedAt", "es.bestWeightKg", "es.bestEstimated1RmKg", "es.bestReps"])
      .where("es.userId = :clientId", { clientId })
      .orderBy("es.lastPerformedAt", "DESC")
      .take(PROGRESSION_TOP_EXERCISES)
      .getMany();

    const exerciseIds = [...new Set(top.map((e) => e.exerciseId))];
    if (exerciseIds.length === 0) return [];

    const sessions = await this.weStatsRepo
      .createQueryBuilder("wes")
      .select(["wes.exerciseId", "wes.startedAt", "wes.bestWeightKg", "wes.bestEstimated1RmKg", "wes.bestReps", "wes.volumeKg"])
      .where("wes.userId = :clientId", { clientId })
      .andWhere("wes.exerciseId IN (:...exerciseIds)", { exerciseIds })
      .orderBy("wes.startedAt", "DESC")
      .take(PROGRESSION_SESSION_CAP)
      .getMany();

    const byExercise = new Map<string, ExerciseSessionSnapshotDto[]>();
    for (const s of sessions) {
      if (!s.exerciseId) continue;
      const list = byExercise.get(s.exerciseId) ?? [];
      if (list.length < recentLimit) {
        list.push({
          startedAt: s.startedAt,
          bestWeightKg: s.bestWeightKg,
          bestEstimated1RmKg: s.bestEstimated1RmKg,
          bestReps: s.bestReps,
          volumeKg: s.volumeKg
        });
      }
      byExercise.set(s.exerciseId, list);
    }

    return top.map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      lastPerformedAt: e.lastPerformedAt,
      workoutCount: e.workoutCount,
      totalVolumeKg: e.totalVolumeKg,
      bestWeightKg: e.bestWeightKg,
      bestEstimated1RmKg: e.bestEstimated1RmKg,
      bestReps: e.bestReps,
      recentSessions: byExercise.get(e.exerciseId) ?? []
    }));
  }

  // ─── Program assignment metrics (bounded, never per-client) ──────────────

  private async assignmentMetrics(
    coachId: string,
    clientIds: string[],
    window: ScoutWindow,
    workoutDaysByClient: Map<string, Set<string>>,
    windowStatsByClient: Map<string, ClientStatAgg>
  ): Promise<Map<string, AssignmentMetrics>> {
    const result = new Map<string, AssignmentMetrics>();
    if (clientIds.length === 0) return result;

    const assignments = await this.assignmentRepo.find({
      where: { coachId, clientId: In(clientIds), isActive: true, isDeleted: false },
      select: { id: true, programId: true, clientId: true, startDate: true, endDate: true, status: true }
    });
    if (assignments.length === 0) return result;

    const programIds = [...new Set(assignments.map((a) => a.programId))];
    const [programs, days] = await Promise.all([
      this.programRepo.find({ where: { id: In(programIds) }, select: { id: true, name: true } }),
      this.dayRepo.find({
        where: { programId: In(programIds) },
        select: { id: true, programId: true, weekNumber: true, dayNumber: true, orderIndex: true, name: true },
        order: { weekNumber: "ASC", dayNumber: "ASC", orderIndex: "ASC" }
      })
    ]);

    const dayIds = days.map((d) => d.id);
    const workouts =
      dayIds.length > 0 ? await this.workoutRepo.find({ where: { programDayId: In(dayIds) }, select: { id: true, programDayId: true, name: true, orderIndex: true } }) : [];

    const workoutsByDay = new Map<string, ProgramWorkout[]>();
    for (const w of workouts) {
      const list = workoutsByDay.get(w.programDayId) ?? [];
      list.push(w);
      workoutsByDay.set(w.programDayId, list);
    }

    const programName = new Map(programs.map((p) => [p.id, p.name]));
    const daysByProgram = new Map<string, ProgramDay[]>();
    for (const d of days) {
      const list = daysByProgram.get(d.programId) ?? [];
      list.push(d);
      daysByProgram.set(d.programId, list);
    }

    const bundlesByClient = new Map<string, { assignment: ProgramAssignment; programName: string; sched: BundleRelations[] }[]>();
    for (const assignment of assignments) {
      const sched = (daysByProgram.get(assignment.programId) ?? []).map((day) => ({
        day,
        scheduledDate: this.scheduledDate(assignment.startDate, day.weekNumber, day.dayNumber),
        workouts: workoutsByDay.get(day.id) ?? []
      }));
      const bundle = {
        assignment,
        programName: programName.get(assignment.programId) ?? "Unknown Program",
        sched: sched.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      };
      const list = bundlesByClient.get(assignment.clientId) ?? [];
      list.push(bundle);
      bundlesByClient.set(assignment.clientId, list);
    }

    for (const [clientId, bundles] of bundlesByClient) {
      const sorted = bundles.slice().sort((a, b) => this.assignmentRank(a, b));
      const metricsList = sorted.map((b) =>
        this.computeAssignmentMetrics(b.assignment, b.programName, b.sched, workoutDaysByClient.get(clientId) ?? new Set(), window, windowStatsByClient.get(clientId))
      );
      result.set(clientId, this.mergeMetrics(metricsList));
    }

    return result;
  }

  private assignmentRank(a: { assignment: ProgramAssignment }, b: { assignment: ProgramAssignment }): number {
    const aActive = a.assignment.status === ProgramAssignmentStatus.ACTIVE ? 0 : 1;
    const bActive = b.assignment.status === ProgramAssignmentStatus.ACTIVE ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.assignment.startDate.getTime() - a.assignment.startDate.getTime();
  }

  private mergeMetrics(metricsList: AssignmentMetrics[]): AssignmentMetrics {
    let expectedTrainingDays = 0;
    let completedTrainingDays = 0;
    const missedDetails: MissedWorkoutDto[] = [];
    for (const m of metricsList) {
      expectedTrainingDays += m.expectedTrainingDays;
      completedTrainingDays += m.completedTrainingDays;
      missedDetails.push(...m.missedDetails);
    }
    const missedWorkouts = metricsList.reduce((acc, m) => acc + m.missedWorkouts, 0);
    return {
      expectedTrainingDays,
      completedTrainingDays,
      missedWorkouts,
      missedDetails,
      primarySummary: metricsList[0].primarySummary
    };
  }

  private computeAssignmentMetrics(
    assignment: ProgramAssignment,
    programName: string,
    sched: BundleRelations[],
    workoutDates: Set<string>,
    window: ScoutWindow,
    windowStats: ClientStatAgg | undefined
  ): AssignmentMetrics {
    const isActivePlan = assignment.status === ProgramAssignmentStatus.ACTIVE;
    const totalPlannedWorkouts = sched.reduce((acc, d) => acc + d.workouts.length, 0);
    const due = sched.filter((d) => d.scheduledDate <= window.today && d.scheduledDate >= window.start);
    const dueDays = due.length;
    const scheduledWorkouts = due.reduce((acc, d) => acc + d.workouts.length, 0);

    let completedWorkouts = 0;
    let completedTrainingDays = 0;
    const missedDetails: MissedWorkoutDto[] = [];
    for (const d of due) {
      const completed = workoutDates.has(this.dateKey(d.scheduledDate));
      if (completed) {
        completedWorkouts += d.workouts.length;
        completedTrainingDays += 1;
      } else if (isActivePlan) {
        for (const w of d.workouts) {
          missedDetails.push({
            dayId: d.day.id,
            weekNumber: d.day.weekNumber,
            dayNumber: d.day.dayNumber,
            dayName: d.day.name,
            scheduledDate: d.scheduledDate,
            workoutId: w.id,
            workoutName: w.name
          });
        }
      }
    }

    const missedWorkouts = isActivePlan ? scheduledWorkouts - completedWorkouts : 0;
    const percentComplete = scheduledWorkouts > 0 ? Math.round((completedWorkouts / scheduledWorkouts) * 100) : 0;

    return {
      expectedTrainingDays: isActivePlan ? dueDays : 0,
      completedTrainingDays: isActivePlan ? completedTrainingDays : 0,
      missedWorkouts,
      missedDetails,
      primarySummary: {
        assignmentId: assignment.id,
        programId: assignment.programId,
        programName,
        clientId: assignment.clientId,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        status: assignment.status,
        totalPlannedWorkouts,
        scheduledWorkouts,
        completedWorkouts,
        percentComplete,
        missedWorkouts,
        loggedWorkoutCount: windowStats?.workoutCount ?? 0,
        volumeKg: windowStats?.volumeKg ?? 0
      }
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.coachRepo.findOne({ where: { userId: user.id } });
    if (!coach) throw new ForbiddenException("You do not have a coach profile");
    return coach;
  }

  private resolveWindow(windowDays: number | undefined, cap: number, fallback: number): ScoutWindow {
    const days = typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays >= 1 ? Math.min(Math.floor(windowDays), cap) : fallback;
    const today = new Date();
    return { days, start: new Date(today.getTime() - days * DAY_MS), today };
  }

  private resolveWeeks(weeks: number | undefined): number {
    return typeof weeks === "number" && Number.isFinite(weeks) && weeks >= 1 ? Math.min(Math.floor(weeks), TREND_CAP_WEEKS) : DEFAULT_TREND_WEEKS;
  }

  private resolveRecentLimit(limit: number | undefined): number {
    return typeof limit === "number" && Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 20) : DEFAULT_RECENT_LIMIT;
  }

  private toActivityEntry(row: ActivityRow): ClientActivityEntryDto {
    return {
      workoutId: row.workoutId,
      clientId: row.clientId,
      clientName: row.clientName,
      name: row.name,
      startedAt: row.startedAt,
      durationSeconds: row.durationSeconds,
      volumeKg: this.num(row.volumeKg),
      reps: this.num(row.reps),
      setCount: this.num(row.setCount),
      exerciseCount: this.num(row.exerciseCount)
    };
  }

  private scheduledDate(startDate: Date, weekNumber: number, dayNumber: number): Date {
    const addDays = (weekNumber - 1) * 7 + (dayNumber - 1);
    return new Date(startDate.getTime() + addDays * DAY_MS);
  }

  /** UTC calendar date key (YYYY-MM-DD) — matches `to_char(...)` in SQL. */
  private dateKey(date: Date): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  private num(value: string | number | null | undefined): number {
    if (value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
