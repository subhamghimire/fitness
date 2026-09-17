import { PersonalRecordType } from "./enums/progress.enum";

/**
 * PROGRESS CALCULATION ENGINE (pure, deterministic, framework-free)
 *
 * Every number in the progress domain is derived through these functions.
 * They are deliberately free of I/O so the entire domain is unit-testable and
 * reproducible: given the same set rows, they always produce the same metrics.
 *
 * Metric definitions (documented once here, referenced by the projections):
 *
 *   - `setCount`   : number of WORKING sets (warm-ups excluded).
 *   - `reps`       : sum of reps across working sets.
 *   - `volumeKg`   : Σ(weight × reps) over working sets with weight & reps > 0.
 *   - `bestWeightKg`   : max single-set weight over working sets.
 *   - `bestReps`       : max single-set reps over working sets.
 *   - `bestEstimated1RmKg`: max Epley estimate `weight × (1 + reps / 30)`.
 *   - `bestDistanceM`  : max single-set distance (conditioning).
 *   - `bestTimeSeconds`: max single-set duration (conditioning).
 *
 * Warm-ups are excluded from every metric. Drop sets count as working sets.
 */

export interface SetInput {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  isWarmup: boolean;
  isDropset: boolean;
  isFailure: boolean;
  durationSeconds: number | null;
  distance: number | null;
  orderIndex: number;
}

export interface SessionInput {
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string | null;
  name: string | null;
  startedAt: Date;
  sets: SetInput[];
}

export interface WorkoutStat {
  workoutId: string;
  name: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  volumeKg: number;
  reps: number;
  setCount: number;
  exerciseCount: number;
}

export interface SessionStat {
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string | null;
  name: string | null;
  startedAt: Date;
  setCount: number;
  reps: number;
  volumeKg: number;
  bestWeightKg: number | null;
  bestReps: number | null;
  bestEstimated1RmKg: number | null;
  bestDistanceM: number | null;
  bestTimeSeconds: number | null;
}

export interface RecordRef {
  value: number;
  workoutId: string;
  workoutExerciseId: string;
  achievedAt: Date;
}

export interface ExerciseAggregate {
  workoutCount: number;
  totalVolumeKg: number;
  totalReps: number;
  firstPerformedAt: Date | null;
  lastPerformedAt: Date | null;
  best: Partial<Record<PersonalRecordType, RecordRef>>;
}

export interface PersonalRecordEvent extends RecordRef {
  prType: PersonalRecordType;
}

/** Epley formula (most common single-input 1RM estimate, deterministic). */
export function epleyOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

function workingSets(sets: SetInput[]): SetInput[] {
  return sets.filter((s) => !s.isWarmup);
}

function setVolume(set: SetInput): number {
  if (set.isWarmup || !set.weight || !set.reps || set.weight <= 0 || set.reps <= 0) return 0;
  return set.weight * set.reps;
}

const maxBy = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return Math.max(...values);
};

export function computeDurationSeconds(input: { durationSeconds: number | null; startedAt: Date; endedAt: Date | null }): number | null {
  const { durationSeconds, startedAt, endedAt } = input;
  if (durationSeconds != null && durationSeconds > 0) return Math.floor(durationSeconds);
  if (endedAt) {
    const diffMs = endedAt.getTime() - startedAt.getTime();
    if (diffMs > 0) return Math.floor(diffMs / 1000);
  }
  return null;
}

export function computeWorkoutStat(
  input: {
    workoutId: string;
    name: string | null;
    startedAt: Date;
    endedAt: Date | null;
    durationSeconds: number | null;
  },
  sessions: SessionInput[]
): WorkoutStat {
  const durationSeconds = computeDurationSeconds({
    durationSeconds: input.durationSeconds,
    startedAt: input.startedAt,
    endedAt: input.endedAt
  });

  let volumeKg = 0;
  let reps = 0;
  let setCount = 0;

  for (const session of sessions) {
    const working = workingSets(session.sets);
    setCount += working.length;
    for (const set of working) {
      volumeKg += setVolume(set);
      reps += set.reps && set.reps > 0 ? set.reps : 0;
    }
  }

  return {
    workoutId: input.workoutId,
    name: input.name,
    startedAt: input.startedAt,
    durationSeconds,
    volumeKg: round2(volumeKg),
    reps,
    setCount,
    exerciseCount: sessions.filter((s) => s.sets.length > 0).length
  };
}

export function computeSessionStat(session: SessionInput): SessionStat {
  const working = workingSets(session.sets);

  const volumes = working.map(setVolume);
  const weights = working.filter((s) => s.weight != null && s.weight > 0).map((s) => s.weight as number);
  const reps = working.filter((s) => s.reps != null && s.reps > 0).map((s) => s.reps as number);
  const estimates = working.filter((s) => s.weight != null && s.weight > 0 && s.reps != null && s.reps > 0).map((s) => epleyOneRepMax(s.weight as number, s.reps as number));
  const distances = working.filter((s) => s.distance != null && s.distance > 0).map((s) => s.distance as number);
  const times = working.filter((s) => s.durationSeconds != null && s.durationSeconds > 0).map((s) => s.durationSeconds as number);

  const repSum = working.reduce((acc, s) => acc + (s.reps && s.reps > 0 ? s.reps : 0), 0);

  return {
    workoutId: session.workoutId,
    workoutExerciseId: session.workoutExerciseId,
    exerciseId: session.exerciseId,
    name: session.name,
    startedAt: session.startedAt,
    setCount: working.length,
    reps: repSum,
    volumeKg: round2(volumes.reduce((a, b) => a + b, 0)),
    bestWeightKg: maxBy(weights),
    bestReps: maxBy(reps),
    bestEstimated1RmKg: estimates.length ? Math.max(...estimates) : null,
    bestDistanceM: maxBy(distances),
    bestTimeSeconds: maxBy(times)
  };
}

const SESSION_RECORD_FIELDS: Array<{ type: PersonalRecordType; pick: (s: SessionStat) => number | null }> = [
  { type: PersonalRecordType.BEST_WEIGHT_KG, pick: (s) => s.bestWeightKg },
  { type: PersonalRecordType.BEST_REPS, pick: (s) => s.bestReps },
  { type: PersonalRecordType.BEST_VOLUME_KG, pick: (s) => s.volumeKg },
  { type: PersonalRecordType.BEST_ESTIMATED_1RM_KG, pick: (s) => s.bestEstimated1RmKg },
  { type: PersonalRecordType.BEST_DISTANCE_M, pick: (s) => s.bestDistanceM },
  { type: PersonalRecordType.BEST_TIME_SECONDS, pick: (s) => s.bestTimeSeconds }
];

/**
 * Aggregates session stats for one (user, exercise) into cumulative totals and
 * absolute bests, and detects the personal-record chain.
 *
 * `sessions` MUST be sorted ascending by (startedAt, workoutId, workoutExerciseId)
 * so PR detection is deterministic (LWW on ties).
 *
 * `detectPersonalRecords` walks the timeline and emits an event every time a
 * running best is *strictly* exceeded. Equal values do not create events, which
 * keeps replays/corrections from fabricating duplicate PRs — an edit that lowers
 * a value and then restores it will re-emit exactly one event at the same
 * achievedAt.
 */
export function aggregateExerciseStats(sessions: SessionStat[]): ExerciseAggregate {
  const best: Partial<Record<PersonalRecordType, RecordRef>> = {};
  const personalRecords: PersonalRecordEvent[] = [];

  for (const session of sessions) {
    for (const { type, pick } of SESSION_RECORD_FIELDS) {
      const value = pick(session);
      if (value == null || value <= 0) continue;
      const current = best[type];
      if (!current || value > current.value) {
        const ref: RecordRef = {
          value,
          workoutId: session.workoutId,
          workoutExerciseId: session.workoutExerciseId,
          achievedAt: session.startedAt
        };
        best[type] = ref;
        personalRecords.push({ prType: type, ...ref });
      }
    }
  }

  const firstPerformedAt = sessions.length > 0 ? sessions[0].startedAt : null;
  const lastPerformedAt = sessions.length > 0 ? sessions[sessions.length - 1].startedAt : null;

  return {
    workoutCount: sessions.filter((s) => s.setCount > 0).length,
    totalVolumeKg: round2(sessions.reduce((acc, s) => acc + s.volumeKg, 0)),
    totalReps: sessions.reduce((acc, s) => acc + s.reps, 0),
    firstPerformedAt,
    lastPerformedAt,
    best
  };
}

/**
 * Standalone PR-chain detector used by the projections (separate from the
 * aggregate so both stay intentionally simple).
 */
export function detectPersonalRecords(sessions: SessionStat[]): PersonalRecordEvent[] {
  const events: PersonalRecordEvent[] = [];
  const best: Partial<Record<PersonalRecordType, number>> = {};

  for (const session of sessions) {
    for (const { type, pick } of SESSION_RECORD_FIELDS) {
      const value = pick(session);
      if (value == null || value <= 0) continue;
      const current = best[type];
      if (current == null || value > current) {
        best[type] = value;
        events.push({
          prType: type,
          value,
          workoutId: session.workoutId,
          workoutExerciseId: session.workoutExerciseId,
          achievedAt: session.startedAt
        });
      }
    }
  }
  return events;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
