import type { SetData, Workout } from '@/types';

export type PRKind =
  | 'heaviest_weight'
  | 'most_reps_at_weight'
  | 'estimated_1rm'
  | 'session_volume'
  | 'best_set_volume';

export interface PersonalRecord {
  kind: PRKind;
  exerciseName: string;
  label: string;
  valueLabel: string;
  weight?: number;
  reps?: number;
  volume?: number;
  e1rm?: number;
}

export interface RichPRData {
  maxWeight: number;
  maxReps: number;
  maxSessionVolume: number;
  maxSetVolume: number;
  estimated1RM: number;
  bestRepsAtMaxWeight: number;
}

/** Epley estimated 1RM — good enough for tracking trends, not competition peaking. */
export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + 12 / 30); // cap formula noise
  return weight * (1 + reps / 30);
}

function isWorking(s: SetData): boolean {
  return !s.isWarmup && (s.weight ?? 0) > 0 && (s.reps ?? 0) > 0;
}

export function getRichExercisePRs(workouts: Workout[]): Record<string, RichPRData> {
  const prs: Record<string, RichPRData> = {};

  for (const w of workouts) {
    for (const ex of w.exercises) {
      const key = ex.name.trim().toLowerCase();
      if (!key) continue;
      if (!prs[key]) {
        prs[key] = {
          maxWeight: 0,
          maxReps: 0,
          maxSessionVolume: 0,
          maxSetVolume: 0,
          estimated1RM: 0,
          bestRepsAtMaxWeight: 0,
        };
      }
      const pr = prs[key];
      let sessionVol = 0;
      for (const s of ex.sets) {
        if (!isWorking(s)) continue;
        const wt = s.weight!;
        const rp = s.reps!;
        const setVol = wt * rp;
        sessionVol += setVol;
        if (wt > pr.maxWeight) {
          pr.maxWeight = wt;
          pr.bestRepsAtMaxWeight = rp;
        } else if (wt === pr.maxWeight && rp > pr.bestRepsAtMaxWeight) {
          pr.bestRepsAtMaxWeight = rp;
        }
        if (rp > pr.maxReps) pr.maxReps = rp;
        if (setVol > pr.maxSetVolume) pr.maxSetVolume = setVol;
        const e1 = estimate1RM(wt, rp);
        if (e1 > pr.estimated1RM) pr.estimated1RM = e1;
      }
      if (sessionVol > pr.maxSessionVolume) pr.maxSessionVolume = sessionVol;
    }
  }

  return prs;
}

/**
 * Detect PRs achieved in `current` sets vs historical workouts (excluding current workout id).
 * Cheap — intended to run after set complete, not on every keystroke.
 */
export function detectNewPRs(params: {
  exerciseName: string;
  currentSets: SetData[];
  history: Workout[];
  currentWorkoutId?: string;
  unit?: string;
}): PersonalRecord[] {
  const { exerciseName, currentSets, history, currentWorkoutId, unit = 'kg' } = params;
  const prior = history.filter((w) => w.id !== currentWorkoutId);
  const priorPRs = getRichExercisePRs(prior);
  const key = exerciseName.trim().toLowerCase();
  const existing = priorPRs[key] ?? {
    maxWeight: 0,
    maxReps: 0,
    maxSessionVolume: 0,
    maxSetVolume: 0,
    estimated1RM: 0,
    bestRepsAtMaxWeight: 0,
  };

  const found: PersonalRecord[] = [];
  let sessionVol = 0;

  for (const s of currentSets) {
    if (!isWorking(s)) continue;
    const wt = s.weight!;
    const rp = s.reps!;
    const setVol = wt * rp;
    sessionVol += setVol;

    if (wt > existing.maxWeight) {
      found.push({
        kind: 'heaviest_weight',
        exerciseName,
        label: 'Weight PR',
        valueLabel: `${wt} ${unit}`,
        weight: wt,
        reps: rp,
      });
      existing.maxWeight = wt;
    }

    const e1 = estimate1RM(wt, rp);
    if (e1 > existing.estimated1RM + 0.5) {
      found.push({
        kind: 'estimated_1rm',
        exerciseName,
        label: 'Est. 1RM PR',
        valueLabel: `${Math.round(e1)} ${unit}`,
        e1rm: e1,
        weight: wt,
        reps: rp,
      });
      existing.estimated1RM = e1;
    }

    if (setVol > existing.maxSetVolume) {
      found.push({
        kind: 'best_set_volume',
        exerciseName,
        label: 'Best set',
        valueLabel: `${wt} × ${rp}`,
        volume: setVol,
        weight: wt,
        reps: rp,
      });
      existing.maxSetVolume = setVol;
    }
  }

  if (sessionVol > existing.maxSessionVolume && sessionVol > 0) {
    found.push({
      kind: 'session_volume',
      exerciseName,
      label: 'Volume PR',
      valueLabel: `${Math.round(sessionVol)} ${unit}`,
      volume: sessionVol,
    });
  }

  // Deduplicate by kind keeping first
  const seen = new Set<PRKind>();
  return found.filter((pr) => {
    if (seen.has(pr.kind)) return false;
    seen.add(pr.kind);
    return true;
  });
}

export function workoutVolume(w: Workout): number {
  return w.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((s, set) => s + (set.weight ?? 0) * (set.reps ?? 0), 0),
    0
  );
}

export function workoutWorkingSets(w: Workout): number {
  return w.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => !s.isWarmup).length,
    0
  );
}

export interface WorkoutSummary {
  exerciseCount: number;
  setCount: number;
  workingSets: number;
  volume: number;
  volumeDeltaPct: number | null;
  prs: PersonalRecord[];
  highlights: string[];
}

export function summarizeWorkout(
  workout: Workout,
  history: Workout[],
  unit = 'kg'
): WorkoutSummary {
  const volume = workoutVolume(workout);
  const priorSame = history
    .filter((w) => w.id !== workout.id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const prevVol = priorSame ? workoutVolume(priorSame) : null;
  const volumeDeltaPct =
    prevVol != null && prevVol > 0 ? Math.round(((volume - prevVol) / prevVol) * 100) : null;

  const prs: PersonalRecord[] = [];
  for (const ex of workout.exercises) {
    prs.push(
      ...detectNewPRs({
        exerciseName: ex.name,
        currentSets: ex.sets,
        history,
        currentWorkoutId: workout.id,
        unit,
      })
    );
  }

  const highlights: string[] = [];
  if (volumeDeltaPct != null && volumeDeltaPct >= 5) {
    highlights.push(`Volume +${volumeDeltaPct}% vs last session`);
  } else if (volumeDeltaPct != null && volumeDeltaPct <= -10) {
    highlights.push(`Volume ${volumeDeltaPct}% vs last session`);
  }
  if (prs.length > 0) {
    highlights.push(`${prs.length} PR${prs.length === 1 ? '' : 's'} today`);
  }

  return {
    exerciseCount: workout.exercises.length,
    setCount: workout.exercises.reduce((a, e) => a + e.sets.length, 0),
    workingSets: workoutWorkingSets(workout),
    volume,
    volumeDeltaPct,
    prs,
    highlights,
  };
}

export interface WeeklySummary {
  workouts: number;
  exercises: number;
  workingSets: number;
  volume: number;
  prCount: number;
  observations: string[];
}

export function getWeeklySummary(workouts: Workout[], unit = 'kg'): WeeklySummary {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

  const thisWeek = workouts.filter((w) => Date.parse(w.startedAt) >= weekAgo);
  const lastWeek = workouts.filter((w) => {
    const t = Date.parse(w.startedAt);
    return t >= twoWeeksAgo && t < weekAgo;
  });

  const vol = (list: Workout[]) => list.reduce((a, w) => a + workoutVolume(w), 0);
  const sets = (list: Workout[]) => list.reduce((a, w) => a + workoutWorkingSets(w), 0);
  const exCount = thisWeek.reduce((a, w) => a + w.exercises.length, 0);

  let prCount = 0;
  for (const w of thisWeek) {
    for (const ex of w.exercises) {
      prCount += detectNewPRs({
        exerciseName: ex.name,
        currentSets: ex.sets,
        history: workouts,
        currentWorkoutId: w.id,
        unit,
      }).length;
    }
  }

  const observations: string[] = [];
  if (thisWeek.length > lastWeek.length) {
    observations.push('Training frequency up vs last week.');
  } else if (thisWeek.length < lastWeek.length && lastWeek.length > 0) {
    observations.push('Fewer sessions than last week.');
  }
  const thisVol = vol(thisWeek);
  const lastVol = vol(lastWeek);
  if (lastVol > 0 && thisVol > lastVol * 1.1) {
    observations.push('Volume is higher than last week.');
  } else if (lastVol > 0 && thisVol < lastVol * 0.85) {
    observations.push('Volume dipped compared with last week.');
  }
  if (observations.length === 0 && thisWeek.length > 0) {
    observations.push('Solid week — keep showing up.');
  }

  return {
    workouts: thisWeek.length,
    exercises: exCount,
    workingSets: sets(thisWeek),
    volume: thisVol,
    prCount,
    observations,
  };
}

export function filterWorkoutsByRange(
  workouts: Workout[],
  range: '7D' | '30D' | '3M' | '6M' | '1Y' | 'ALL'
): Workout[] {
  if (range === 'ALL') return workouts;
  const days =
    range === '7D' ? 7 : range === '30D' ? 30 : range === '3M' ? 90 : range === '6M' ? 180 : 365;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return workouts.filter((w) => Date.parse(w.startedAt) >= cutoff);
}

export function getExerciseSessionHistory(
  workouts: Workout[],
  exerciseName: string
): {
  workoutId: string;
  date: string;
  startedAt: string;
  sets: SetData[];
  maxWeight: number;
  volume: number;
  e1rm: number;
}[] {
  const key = exerciseName.trim().toLowerCase();
  const rows: {
    workoutId: string;
    date: string;
    startedAt: string;
    sets: SetData[];
    maxWeight: number;
    volume: number;
    e1rm: number;
  }[] = [];

  for (const w of workouts) {
    const ex = w.exercises.find((e) => e.name.trim().toLowerCase() === key);
    if (!ex) continue;
    let maxWeight = 0;
    let volume = 0;
    let e1rm = 0;
    for (const s of ex.sets) {
      if (!isWorking(s)) continue;
      maxWeight = Math.max(maxWeight, s.weight!);
      volume += s.weight! * s.reps!;
      e1rm = Math.max(e1rm, estimate1RM(s.weight!, s.reps!));
    }
    rows.push({
      workoutId: w.id,
      date: w.startedAt,
      startedAt: w.startedAt,
      sets: ex.sets,
      maxWeight,
      volume,
      e1rm,
    });
  }

  return rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
