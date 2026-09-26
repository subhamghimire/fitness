import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, MoreThanOrEqual, Or, Repository, SelectQueryBuilder } from "typeorm";
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
import { ProgramAssignmentStatus, ACTIVE_ASSIGNMENT_STATUSES } from "src/modules/program/enums/program.enum";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutStat } from "src/modules/progress/entities/workout-stat.entity";
import { WorkoutExerciseStat } from "src/modules/progress/entities/workout-exercise-stat.entity";
import { ExerciseStat } from "src/modules/progress/entities/exercise-stat.entity";
import { PersonalRecord } from "src/modules/progress/entities/personal-record.entity";
import { VolumeGranularity } from "src/modules/progress/enums/progress.enum";
import { ProgressService } from "src/modules/progress/progress.service";
import {
  CoachActivityQueryDto,
  CoachClientDetailQueryDto,
  CoachClientListQueryDto,
  CoachDashboardQueryDto,
  CoachMissedWorkoutQueryDto,
  CoachPendingRequestQueryDto
} from "./dto/coach-dashboard-query.dto";
import {
  ClientActivityEntryDto,
  ClientProgressDetailDto,
  ClientProgressSummaryDto,
  CoachDashboardOverviewResponseDto,
  ExerciseProgressionDto,
  ExerciseSessionSnapshotDto,
  MissedWorkoutDto,
  MissedWorkoutEntryDto,
  PaginatedClientActivityResponseDto,
  PaginatedClientProgressSummaryResponseDto,
  PaginatedMissedWorkoutResponseDto,
  PaginatedPendingRequestResponseDto,
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
const PENDING_REQUEST_PREVIEW = 6;
const FEED_PREVIEW = 6;
const TREND_CAP_WEEKS = 52;
const PROGRESSION_TOP_EXERCISES = 5;

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

/** Spendable pool of logged workouts, keyed by calendar day. See `dayCreditBudget`. */
interface DayCreditBudget {
  take: (dateKey: string, slots: number) => number;
}

interface AssignmentMetrics {
  expectedTrainingDays: number;
  completedTrainingDays: number;
  missedWorkouts: number;
  missedDetails: MissedWorkoutDto[];
  primarySummary: ProgramProgressSummaryDto;
  summaries: ProgramProgressSummaryDto[];
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

interface PendingRequestRow {
  relationshipId: string;
  createdAt: Date;
  clientId: string;
  clientName: string;
  clientEmail: string;
}

interface RecentPrRow {
  clientId: string;
  clientName: string;
  prType: PersonalRecord["prType"];
  value: string | number;
  exerciseId: string | null;
  exerciseName: string | null;
  workoutId: string;
  achievedAt: Date;
}

interface WorkoutDayRow {
  userId: string;
  day: string;
  workoutCount: string | number;
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
    const scopeVersion = await this.relationshipScopeVersion(coach.id);

    const cacheKey = `overview:${coach.id}:${window.days}:${weeks}:${scopeVersion}`;
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
    const scopeVersion = await this.relationshipScopeVersion(coach.id);

    const cacheKey = `clients:${coach.id}:${page}:${limit}:${window.days}:${scopeVersion}`;
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
    const windowStatsPromise = this.groupedWindowStats([clientIdKey], window.start);
    const workoutDaysPromise = this.workoutDayCounts([clientIdKey], window.start);
    const assignmentPromise = Promise.all([windowStatsPromise, workoutDaysPromise]).then(([windowStatsRows, workoutDayRows]) =>
      this.assignmentMetrics(coach.id, [clientIdKey], window, workoutDayRows, windowStatsRows, true)
    );
    const progressReadsPromise = Promise.all([
      this.progressService.overview(clientIdKey, { weeks }),
      this.progressService.volumeHistory(clientIdKey, {
        granularity: VolumeGranularity.WEEK,
        from: new Date(Date.now() - weeks * WEEK_MS)
      }),
      this.progressService.listPersonalRecords(clientIdKey, { page: 1, limit: recentLimit })
    ]);

    const [windowStatsRows, recentWorkouts, exerciseProgression, metrics, [overviewRes, volumeHistory, recentPrs]] = await Promise.all([
      windowStatsPromise,
      this.clientRecentWorkouts(clientIdKey, recentLimit),
      this.exerciseProgression(clientIdKey, recentLimit),
      assignmentPromise,
      progressReadsPromise
    ]);
    const windowStats = windowStatsRows.get(clientIdKey);
    const clientMetrics = metrics.get(clientIdKey);
    const finalAdherence = this.computeAdherence(windowStats?.activeDays ?? 0, clientMetrics, window, relationship.startedAt);

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
      weeklyFrequency: overviewRes.weeklyWorkoutFrequency,
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

  async pendingRequests(user: User, query: CoachPendingRequestQueryDto): Promise<PaginatedPendingRequestResponseDto> {
    const coach = await this.requireCoach(user);
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);

    const qb = this.pendingRequestsQuery(coach.id);
    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const rows = await qb.getRawMany<PendingRequestRow>();

    return createPaginatedResponse(
      rows.map((row) => this.toPendingRequest(row)),
      total,
      page,
      limit
    );
  }

  /**
   * Cross-client "who is falling behind?" queue.
   *
   * This is the one dashboard metric that cannot be answered from the
   * materialized projections: a missed workout only exists once the program
   * schedule is overlaid on what the client actually logged, so it is derived
   * from the schedule tables rather than counted in SQL.
   *
   * Query budget is fixed (5 reads regardless of client count) and the schedule
   * is bounded by the trailing window, so the result set is materialized once
   * and then paginated in memory. Entries are ordered oldest-scheduled-first
   * because the most overdue slot is the most actionable thing on a coach's
   * screen.
   */
  async missedWorkouts(user: User, query: CoachMissedWorkoutQueryDto): Promise<PaginatedMissedWorkoutResponseDto> {
    const coach = await this.requireCoach(user);
    const window = this.resolveWindow(query.windowDays, DEFAULT_WINDOW_CAP, DEFAULT_WINDOW_DAYS);
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);

    const relationships = await this.liveRelationshipsQuery(coach.id).getRawMany<LiveRelation>();
    if (relationships.length === 0) return createPaginatedResponse([], 0, page, limit);

    const clientIds = relationships.map((r) => r.clientId);
    const workoutDays = await this.workoutDayCounts(clientIds, window.start);
    const metrics = await this.assignmentMetrics(coach.id, clientIds, window, workoutDays, new Map(), true);

    const nameByClient = new Map(relationships.map((r) => [r.clientId, r.clientName]));
    const entries: MissedWorkoutEntryDto[] = [];
    for (const [clientId, clientMetrics] of metrics) {
      const clientName = nameByClient.get(clientId);
      if (!clientName) continue;
      for (const missed of clientMetrics.missedDetails) {
        entries.push({
          ...missed,
          clientId,
          clientName,
          daysOverdue: this.daysBetween(missed.scheduledDate, window.today)
        });
      }
    }

    entries.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime() || a.clientId.localeCompare(b.clientId) || a.workoutId.localeCompare(b.workoutId));

    return createPaginatedResponse(entries.slice((page - 1) * limit, (page - 1) * limit + limit), entries.length, page, limit);
  }

  // ─── Overview assembly ───────────────────────────────────────────────────

  private async buildOverview(coachId: string, window: ScoutWindow, weeks: number): Promise<CoachDashboardOverviewResponseDto> {
    const [statuses, relationships, windowStats, totals, workoutDays, prCounts] = await Promise.all([
      this.statusCounts(coachId),
      this.liveRelationshipsQuery(coachId).getRawMany<LiveRelation>(),
      this.groupedWindowStatsCte(coachId, window.start),
      this.groupedTotalStatsCte(coachId),
      this.coachWorkoutDays(coachId, window.start),
      this.prCountsCte(coachId, window.start)
    ]);

    const [metrics, pendingRequests, recentClientWorkouts, recentPersonalRecords, trends] = await Promise.all([
      this.assignmentMetrics(
        coachId,
        relationships.map((r) => r.clientId),
        window,
        workoutDays,
        windowStats
      ),
      this.pendingRequestsPreview(coachId),
      this.coachRecentWorkouts(coachId, FEED_PREVIEW),
      this.coachRecentPrs(coachId, FEED_PREVIEW),
      this.coachTrends(coachId, weeks)
    ]);

    const summaries = relationships.map((r) =>
      this.buildSummary(r, window, windowStats.get(r.clientId), totals.get(r.clientId), metrics.get(r.clientId), prCounts.get(r.clientId) ?? 0)
    );
    const activeSummaries = summaries.filter((summary) => summary.relationship.status === RelationshipStatus.ACTIVE);
    const activeClientIds = new Set(activeSummaries.map((summary) => summary.client.id));
    const activeMetrics = new Map([...metrics].filter(([clientId]) => activeClientIds.has(clientId)));
    const pausedClientCount = relationships.filter((r) => r.status === RelationshipStatus.PAUSED).length;
    const pendingRequestCount = statuses.get(RelationshipStatus.PENDING) ?? 0;

    return {
      activeClientCount: activeSummaries.length,
      pausedClientCount,
      pendingRequestCount,
      activeClients: activeSummaries.slice(0, OVERVIEW_CLIENT_PREVIEW),
      pendingRequests,
      recentClientWorkouts,
      workoutAdherence: this.aggregateAdherence(activeSummaries),
      programProgress: this.aggregateProgramProgress(activeMetrics),
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
      this.workoutDayCounts(clientIds, window.start),
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
    const programBasis = metrics !== undefined;
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
    const summaries = [...metricsByClient.values()].flatMap((metrics) => metrics.summaries);
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
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .andWhere("u.isDeleted = :clientDeleted", { clientDeleted: false })
      .orderBy("cc.startedAt", "DESC")
      .addOrderBy("cc.id", "DESC");
  }

  /**
   * Cache namespace derived from relationship state. Every cache hit still
   * performs this cheap indexed probe, so ending, blocking, deleting or
   * replacing a relationship cannot expose stale client PII from a TTL cache.
   *
   * The fingerprint is taken over `(relationship id, status, client soft-delete
   * flag)` for every non-deleted row rather than over a `MAX(updated_at)`: a
   * plain timestamp maximum is not monotonic across rows, so ending one
   * relationship while another row keeps a later timestamp would leave the
   * namespace unchanged and keep serving the ended client's data.
   */
  private async relationshipScopeVersion(coachId: string): Promise<string> {
    const row = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("COUNT(*)", "count")
      .addSelect("md5(string_agg(cc.id::text || ':' || cc.status::text || ':' || u.isDeleted::text, ',' ORDER BY cc.id))", "fingerprint")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .getRawOne<{ count: string; fingerprint: string | null }>();
    return `${row?.count ?? "0"}:${row?.fingerprint ?? "none"}`;
  }

  private async statusCounts(coachId: string): Promise<Map<RelationshipStatus, number>> {
    const rows = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.status", "status")
      .addSelect("COUNT(*)", "count")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .andWhere("u.isDeleted = :clientDeleted", { clientDeleted: false })
      .groupBy("cc.status")
      .getRawMany<{ status: RelationshipStatus; count: string }>();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  private pendingRequestsQuery(coachId: string) {
    return this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.id", "relationshipId")
      .addSelect("cc.createdAt", "createdAt")
      .addSelect("cc.clientId", "clientId")
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status = :status", { status: RelationshipStatus.PENDING })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .andWhere("u.isDeleted = :clientDeleted", { clientDeleted: false })
      .orderBy("cc.createdAt", "DESC")
      .addOrderBy("cc.id", "DESC");
  }

  private async pendingRequestsPreview(coachId: string): Promise<PendingRequestDto[]> {
    const rows = await this.pendingRequestsQuery(coachId).take(PENDING_REQUEST_PREVIEW).getRawMany<PendingRequestRow>();
    return rows.map((row) => this.toPendingRequest(row));
  }

  /** Privacy gate: only live relationships are visible to the coach. */
  private async findLiveRelationship(coachId: string, clientId: string): Promise<LiveRelation> {
    const row = await this.relationshipRepo
      .createQueryBuilder("cc")
      .select("cc.id", "id")
      .addSelect("cc.status", "status")
      .addSelect("cc.startedAt", "startedAt")
      .addSelect("cc.clientId", "clientId")
      .addSelect("u.name", "clientName")
      .addSelect("u.email", "clientEmail")
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.clientId = :clientId", { clientId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .andWhere("u.isDeleted = :clientDeleted", { clientDeleted: false })
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
      .innerJoin("cc.client", "u")
      .where("cc.coachId = :coachId", { coachId })
      .andWhere("cc.status IN (:...statuses)", { statuses: LIVE_STATUSES })
      .andWhere("cc.isDeleted = :deleted", { deleted: false })
      .andWhere("u.isDeleted = :clientDeleted", { clientDeleted: false });
  }

  private scopedByLiveClients(qb: SelectQueryBuilder<WorkoutStat>, coachId: string): SelectQueryBuilder<WorkoutStat> {
    const cte = this.liveClientCte(coachId);
    qb.addCommonTableExpression(cte, "coach_live_clients");
    qb.andWhere("ws.userId IN (SELECT clc.client_id FROM coach_live_clients clc)");
    return qb;
  }

  /**
   * Projection workers remove soft-deleted source workouts asynchronously. The
   * dashboard joins the source row so a deleted workout disappears immediately,
   * while a synced workout becomes visible as soon as its projection lands.
   */
  private onlyLiveWorkoutStats(qb: SelectQueryBuilder<WorkoutStat>): SelectQueryBuilder<WorkoutStat> {
    return qb
      .innerJoin(Workout, "sourceWorkout", "sourceWorkout.id = ws.workoutId AND sourceWorkout.userId = ws.userId")
      .andWhere("ws.isDeleted = :projectionDeleted", { projectionDeleted: false })
      .andWhere("sourceWorkout.isDeleted = :workoutDeleted", { workoutDeleted: false })
      .andWhere("sourceWorkout.deletedAt IS NULL");
  }

  private onlyLivePersonalRecords(qb: SelectQueryBuilder<PersonalRecord>): SelectQueryBuilder<PersonalRecord> {
    return qb
      .innerJoin(Workout, "sourceWorkout", "sourceWorkout.id = pr.workoutId AND sourceWorkout.userId = pr.userId")
      .andWhere("pr.isDeleted = :recordDeleted", { recordDeleted: false })
      .andWhere("sourceWorkout.isDeleted = :workoutDeleted", { workoutDeleted: false })
      .andWhere("sourceWorkout.deletedAt IS NULL");
  }

  private onlyLiveWorkoutExerciseStats(qb: SelectQueryBuilder<WorkoutExerciseStat>): SelectQueryBuilder<WorkoutExerciseStat> {
    return qb
      .innerJoin(Workout, "sourceWorkout", "sourceWorkout.id = wes.workoutId AND sourceWorkout.userId = wes.userId")
      .andWhere("wes.isDeleted = :projectionDeleted", { projectionDeleted: false })
      .andWhere("sourceWorkout.isDeleted = :workoutDeleted", { workoutDeleted: false })
      .andWhere("sourceWorkout.deletedAt IS NULL");
  }

  private groupedWindowStatsCte(coachId: string, from: Date): Promise<Map<string, ClientStatAgg>> {
    const qb = this.onlyLiveWorkoutStats(this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId));
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb.andWhere("ws.startedAt >= :from", { from }));
  }

  private groupedTotalStatsCte(coachId: string): Promise<Map<string, ClientStatAgg>> {
    const qb = this.onlyLiveWorkoutStats(this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId));
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb);
  }

  private groupedWindowStats(clientIds: string[], from: Date): Promise<Map<string, ClientStatAgg>> {
    const qb = this.onlyLiveWorkoutStats(this.workoutStatsRepo.createQueryBuilder("ws"));
    qb.where("ws.userId IN (:...clientIds)", { clientIds }).andWhere("ws.startedAt >= :from", { from });
    this.groupedStatsSelect(qb);
    return this.executeGroupedStats(qb);
  }

  private groupedTotalStats(clientIds: string[]): Promise<Map<string, ClientStatAgg>> {
    const qb = this.onlyLiveWorkoutStats(this.workoutStatsRepo.createQueryBuilder("ws"));
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

  /** Logged-workout counts by (client, UTC calendar day) for the window. */
  private async workoutDayCounts(clientIds: string[], from: Date): Promise<Map<string, Map<string, number>>> {
    if (clientIds.length === 0) return new Map();
    const qb = this.onlyLiveWorkoutStats(this.workoutStatsRepo.createQueryBuilder("ws"))
      .select("ws.userId", "userId")
      .addSelect("to_char(ws.startedAt, 'YYYY-MM-DD')", "day")
      .addSelect("COUNT(*)", "workoutCount")
      .where("ws.userId IN (:...clientIds)", { clientIds })
      .andWhere("ws.startedAt >= :from", { from })
      .groupBy("ws.userId")
      .addGroupBy("to_char(ws.startedAt, 'YYYY-MM-DD')");
    return this.executeWorkoutDayCounts(qb);
  }

  private async coachWorkoutDays(coachId: string, from: Date): Promise<Map<string, Map<string, number>>> {
    const qb = this.onlyLiveWorkoutStats(this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId))
      .select("ws.userId", "userId")
      .addSelect("to_char(ws.startedAt, 'YYYY-MM-DD')", "day")
      .addSelect("COUNT(*)", "workoutCount")
      .andWhere("ws.startedAt >= :from", { from })
      .groupBy("ws.userId")
      .addGroupBy("to_char(ws.startedAt, 'YYYY-MM-DD')");
    return this.executeWorkoutDayCounts(qb);
  }

  private async executeWorkoutDayCounts(qb: SelectQueryBuilder<WorkoutStat>): Promise<Map<string, Map<string, number>>> {
    const rows = await qb.getRawMany<WorkoutDayRow>();
    const map = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const days = map.get(row.userId) ?? new Map<string, number>();
      days.set(row.day, this.num(row.workoutCount));
      map.set(row.userId, days);
    }
    return map;
  }

  private async prCountsCte(coachId: string, from: Date): Promise<Map<string, number>> {
    const qb = this.onlyLivePersonalRecords(this.prRepo.createQueryBuilder("pr"));
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
    const qb = this.onlyLivePersonalRecords(this.prRepo.createQueryBuilder("pr"))
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
    return this.onlyLiveWorkoutStats(this.workoutStatsRepo.createQueryBuilder("ws"))
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
      .innerJoin(User, "u", "u.id = ws.userId")
      .addCommonTableExpression(ct, "coach_live_clients")
      .where("ws.userId IN (SELECT clc.client_id FROM coach_live_clients clc)")
      .orderBy("ws.startedAt", "DESC")
      .addOrderBy("ws.workoutId", "DESC");
  }

  private async coachRecentWorkouts(coachId: string, limit: number): Promise<ClientActivityEntryDto[]> {
    const rows = await this.coachActivityQuery(coachId).limit(limit).getRawMany<ActivityRow>();
    return rows.map((r) => this.toActivityEntry(r));
  }

  private async coachRecentPrs(coachId: string, limit: number): Promise<RecentPrDto[]> {
    const cte = this.liveClientCte(coachId);
    const qb = this.onlyLivePersonalRecords(this.prRepo.createQueryBuilder("pr"));
    const rows = await qb
      .select("pr.userId", "clientId")
      .addSelect("u.name", "clientName")
      .addSelect("pr.prType", "prType")
      .addSelect("pr.value", "value")
      .addSelect("pr.exerciseId", "exerciseId")
      .addSelect("pr.exerciseName", "exerciseName")
      .addSelect("pr.workoutId", "workoutId")
      .addSelect("pr.achievedAt", "achievedAt")
      .innerJoin(User, "u", "u.id = pr.userId")
      .addCommonTableExpression(cte, "coach_live_clients")
      .where("pr.userId IN (SELECT clc.client_id FROM coach_live_clients clc)")
      .orderBy("pr.achievedAt", "DESC")
      .addOrderBy("pr.id", "DESC")
      .limit(limit)
      .getRawMany<RecentPrRow>();
    return rows.map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName,
      prType: r.prType,
      value: this.num(r.value),
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      workoutId: r.workoutId,
      achievedAt: r.achievedAt
    }));
  }

  private async coachTrends(coachId: string, weeks: number): Promise<ProgressTrendEntryDto[]> {
    const trendStart = new Date(Date.now() - weeks * WEEK_MS);
    const qb = this.onlyLiveWorkoutStats(this.scopedByLiveClients(this.workoutStatsRepo.createQueryBuilder("ws"), coachId));
    const rows = await qb
      .select("date_trunc('week', ws.startedAt)", "bucket")
      .addSelect("COUNT(*)", "workoutCount")
      .addSelect("COALESCE(SUM(ws.volumeKg), 0)", "volumeKg")
      .andWhere("ws.startedAt >= :trendStart", { trendStart })
      .groupBy("bucket")
      .orderBy("bucket", "ASC")
      .getRawMany<{ bucket: Date; workoutCount: string; volumeKg: string }>();
    return rows.map((r) => ({ bucket: r.bucket, workoutCount: Number(r.workoutCount), volumeKg: Number(r.volumeKg) }));
  }

  // ─── Single-client queries ───────────────────────────────────────────────

  private async clientRecentWorkouts(clientId: string, limit: number): Promise<RecentWorkoutDto[]> {
    const qb = this.onlyLiveWorkoutStats(this.workoutStatsRepo.createQueryBuilder("ws"));
    const rows = await qb
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
      .addOrderBy("ws.workoutId", "DESC")
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
      .andWhere("es.isDeleted = :projectionDeleted", { projectionDeleted: false })
      .andWhere("es.deletedAt IS NULL")
      .orderBy("es.lastPerformedAt", "DESC")
      .addOrderBy("es.exerciseId", "DESC")
      .take(PROGRESSION_TOP_EXERCISES)
      .getMany();

    const exerciseIds = [...new Set(top.map((e) => e.exerciseId))];
    if (exerciseIds.length === 0) return [];

    const rankedSessions = this.onlyLiveWorkoutExerciseStats(this.weStatsRepo.createQueryBuilder("wes"))
      .select("wes.exerciseId", "exerciseId")
      .addSelect("wes.startedAt", "startedAt")
      .addSelect("wes.bestWeightKg", "bestWeightKg")
      .addSelect("wes.bestEstimated1RmKg", "bestEstimated1RmKg")
      .addSelect("wes.bestReps", "bestReps")
      .addSelect("wes.volumeKg", "volumeKg")
      .addSelect("ROW_NUMBER() OVER (PARTITION BY wes.exerciseId ORDER BY wes.startedAt DESC, wes.workoutId DESC)", "sessionRank")
      .where("wes.userId = :clientId", { clientId })
      .andWhere("wes.exerciseId IN (:...exerciseIds)", { exerciseIds });

    const sessions = await this.weStatsRepo
      .createQueryBuilder()
      .select("ranked.exerciseId", "exerciseId")
      .addSelect("ranked.startedAt", "startedAt")
      .addSelect("ranked.bestWeightKg", "bestWeightKg")
      .addSelect("ranked.bestEstimated1RmKg", "bestEstimated1RmKg")
      .addSelect("ranked.bestReps", "bestReps")
      .addSelect("ranked.volumeKg", "volumeKg")
      .from(`(${rankedSessions.getQuery()})`, "ranked")
      .setParameters(rankedSessions.getParameters())
      .where("ranked.sessionRank <= :sessionLimit", { sessionLimit: recentLimit })
      .orderBy("ranked.startedAt", "DESC")
      .addOrderBy("ranked.exerciseId", "ASC")
      .getRawMany<{
        exerciseId: string;
        startedAt: Date;
        bestWeightKg: number | null;
        bestEstimated1RmKg: number | null;
        bestReps: number | null;
        volumeKg: string | number;
      }>();

    const byExercise = new Map<string, ExerciseSessionSnapshotDto[]>();
    for (const session of sessions) {
      const list = byExercise.get(session.exerciseId) ?? [];
      list.push({
        startedAt: session.startedAt,
        bestWeightKg: session.bestWeightKg,
        bestEstimated1RmKg: session.bestEstimated1RmKg,
        bestReps: session.bestReps,
        volumeKg: this.num(session.volumeKg)
      });
      byExercise.set(session.exerciseId, list);
    }

    return top.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      lastPerformedAt: exercise.lastPerformedAt,
      workoutCount: exercise.workoutCount,
      totalVolumeKg: exercise.totalVolumeKg,
      bestWeightKg: exercise.bestWeightKg,
      bestEstimated1RmKg: exercise.bestEstimated1RmKg,
      bestReps: exercise.bestReps,
      recentSessions: byExercise.get(exercise.exerciseId) ?? []
    }));
  }

  // ─── Program assignment metrics (bounded, never per-client) ──────────────

  private async assignmentMetrics(
    coachId: string,
    clientIds: string[],
    window: ScoutWindow,
    workoutDaysByClient: Map<string, Map<string, number>>,
    windowStatsByClient: Map<string, ClientStatAgg>,
    includeMissedDetails = false
  ): Promise<Map<string, AssignmentMetrics>> {
    const result = new Map<string, AssignmentMetrics>();
    if (clientIds.length === 0) return result;

    const assignments = await this.assignmentRepo.find({
      where: {
        coachId,
        clientId: In(clientIds),
        status: In(ACTIVE_ASSIGNMENT_STATUSES),
        isActive: true,
        isDeleted: false,
        endDate: Or(IsNull(), MoreThanOrEqual(window.start))
      },
      select: { id: true, programId: true, clientId: true, startDate: true, endDate: true, status: true }
    });
    if (assignments.length === 0) return result;

    const candidateProgramIds = [...new Set(assignments.map((assignment) => assignment.programId))];
    const programs = await this.programRepo.find({
      where: { id: In(candidateProgramIds), coachId, isActive: true, isDeleted: false, deletedAt: IsNull() },
      select: { id: true, name: true }
    });
    const programIds = new Set(programs.map((program) => program.id));
    if (programIds.size === 0) return result;

    const days = await this.dayRepo.find({
      where: { programId: In([...programIds]), isDeleted: false, deletedAt: IsNull() },
      select: { id: true, programId: true, weekNumber: true, dayNumber: true, orderIndex: true, name: true },
      order: { weekNumber: "ASC", dayNumber: "ASC", orderIndex: "ASC" }
    });
    const dayIds = days.map((day) => day.id);
    const workouts =
      dayIds.length > 0
        ? await this.workoutRepo.find({
            where: { programDayId: In(dayIds), isDeleted: false, deletedAt: IsNull() },
            select: { id: true, programDayId: true, name: true, orderIndex: true },
            order: { orderIndex: "ASC" }
          })
        : [];

    const workoutsByDay = new Map<string, ProgramWorkout[]>();
    for (const workout of workouts) {
      const list = workoutsByDay.get(workout.programDayId) ?? [];
      list.push(workout);
      workoutsByDay.set(workout.programDayId, list);
    }

    const programNames = new Map(programs.map((program) => [program.id, program.name]));
    const daysByProgram = new Map<string, ProgramDay[]>();
    for (const day of days) {
      const list = daysByProgram.get(day.programId) ?? [];
      list.push(day);
      daysByProgram.set(day.programId, list);
    }

    const bundlesByClient = new Map<string, { assignment: ProgramAssignment; programName: string; schedule: BundleRelations[] }[]>();
    for (const assignment of assignments.filter((candidate) => programIds.has(candidate.programId))) {
      const schedule = (daysByProgram.get(assignment.programId) ?? []).map((day) => ({
        day,
        scheduledDate: this.scheduledDate(assignment.startDate, day.weekNumber, day.dayNumber),
        workouts: workoutsByDay.get(day.id) ?? []
      }));
      const bundle = {
        assignment,
        programName: programNames.get(assignment.programId) ?? "Unknown Program",
        schedule: schedule.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      };
      const list = bundlesByClient.get(assignment.clientId) ?? [];
      list.push(bundle);
      bundlesByClient.set(assignment.clientId, list);
    }

    for (const [clientId, bundles] of bundlesByClient) {
      const sorted = bundles.slice().sort((a, b) => this.assignmentRank(a, b));
      // One shared credit pool per client. A client may legitimately hold two
      // live assignments for different programs (the partial unique index only
      // guards one assignment per (program, client)), and those plans can fall
      // on the same calendar day. Without a shared pool each plan would claim
      // the same logged workout and report 100% adherence for a day the client
      // trained once. Credits are consumed highest-priority assignment first,
      // earliest slot first, so the result stays deterministic.
      const budget = this.dayCreditBudget(workoutDaysByClient.get(clientId));
      const metricsList = sorted.map((bundle) =>
        this.computeAssignmentMetrics(bundle.assignment, bundle.programName, bundle.schedule, budget, window, windowStatsByClient.get(clientId), includeMissedDetails)
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

  /**
   * Mutable per-client pool of logged workouts available to satisfy scheduled
   * slots, keyed by calendar day. `take` is the only way to spend from it, so a
   * credit can never be counted twice across overlapping plans.
   */
  private dayCreditBudget(countsByDay: Map<string, number> | undefined): DayCreditBudget {
    const remaining = new Map<string, number>(countsByDay ?? []);
    return {
      take: (dateKey: string, slots: number): number => {
        const available = remaining.get(dateKey) ?? 0;
        const used = Math.min(available, slots);
        if (used > 0) remaining.set(dateKey, available - used);
        return used;
      }
    };
  }

  private mergeMetrics(metricsList: AssignmentMetrics[]): AssignmentMetrics {
    const expectedTrainingDays = metricsList.reduce((total, metrics) => total + metrics.expectedTrainingDays, 0);
    const completedTrainingDays = metricsList.reduce((total, metrics) => total + metrics.completedTrainingDays, 0);
    const missedWorkouts = metricsList.reduce((total, metrics) => total + metrics.missedWorkouts, 0);
    const summaries = metricsList.map((metrics) => metrics.primarySummary);
    return {
      expectedTrainingDays,
      completedTrainingDays,
      missedWorkouts,
      missedDetails: metricsList.flatMap((metrics) => metrics.missedDetails),
      primarySummary: summaries[0],
      summaries
    };
  }

  private computeAssignmentMetrics(
    assignment: ProgramAssignment,
    programName: string,
    schedule: BundleRelations[],
    creditBudget: DayCreditBudget,
    window: ScoutWindow,
    windowStats: ClientStatAgg | undefined,
    includeMissedDetails: boolean
  ): AssignmentMetrics {
    const isActivePlan = assignment.status === ProgramAssignmentStatus.ACTIVE;
    const totalPlannedWorkouts = schedule.reduce((total, day) => total + day.workouts.length, 0);
    const endDateKey = assignment.endDate ? this.dateKey(assignment.endDate) : null;
    const due = schedule.filter(
      (day) => day.workouts.length > 0 && day.scheduledDate >= window.start && day.scheduledDate <= window.today && (!endDateKey || this.dateKey(day.scheduledDate) <= endDateKey)
    );
    const scheduledWorkouts = due.reduce((total, day) => total + day.workouts.length, 0);

    let completedWorkouts = 0;
    let completedTrainingDays = 0;
    const missedDetails: MissedWorkoutDto[] = [];
    for (const day of due) {
      const completedForDay = creditBudget.take(this.dateKey(day.scheduledDate), day.workouts.length);
      completedWorkouts += completedForDay;
      if (completedForDay > 0) completedTrainingDays += 1;

      if (isActivePlan && includeMissedDetails) {
        for (const workout of day.workouts.slice(completedForDay)) {
          missedDetails.push({
            assignmentId: assignment.id,
            programId: assignment.programId,
            programName,
            dayId: day.day.id,
            weekNumber: day.day.weekNumber,
            dayNumber: day.day.dayNumber,
            dayName: day.day.name,
            scheduledDate: day.scheduledDate,
            workoutId: workout.id,
            workoutName: workout.name
          });
        }
      }
    }

    const missedWorkouts = isActivePlan ? scheduledWorkouts - completedWorkouts : 0;
    const percentComplete = scheduledWorkouts > 0 ? Math.round((completedWorkouts / scheduledWorkouts) * 100) : 0;
    const primarySummary: ProgramProgressSummaryDto = {
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
    };

    return {
      expectedTrainingDays: isActivePlan ? due.length : 0,
      completedTrainingDays: isActivePlan ? completedTrainingDays : 0,
      missedWorkouts,
      missedDetails,
      primarySummary,
      summaries: [primarySummary]
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async requireCoach(user: User): Promise<Coach> {
    const coach = await this.coachRepo.findOne({ where: { userId: user.id, isDeleted: false } });
    if (!coach) throw new ForbiddenException("You do not have a coach profile");
    return coach;
  }

  private resolveWindow(windowDays: number | undefined, cap: number, fallback: number): ScoutWindow {
    const days = typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays >= 1 ? Math.min(Math.floor(windowDays), cap) : fallback;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return { days, start, today };
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

  private toPendingRequest(row: PendingRequestRow): PendingRequestDto {
    return {
      relationshipId: row.relationshipId,
      createdAt: row.createdAt,
      client: { id: row.clientId, name: row.clientName, email: row.clientEmail }
    };
  }

  private scheduledDate(startDate: Date, weekNumber: number, dayNumber: number): Date {
    const addDays = (weekNumber - 1) * 7 + (dayNumber - 1);
    return new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + addDays));
  }

  /** UTC calendar date key (YYYY-MM-DD) — matches `to_char(...)` in SQL. */
  private dateKey(date: Date): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  /** Whole UTC calendar days from `from` to `to` (never negative). */
  private daysBetween(from: Date, to: Date): number {
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return Math.max(0, Math.floor(ms / DAY_MS));
  }

  private num(value: string | number | null | undefined): number {
    if (value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
