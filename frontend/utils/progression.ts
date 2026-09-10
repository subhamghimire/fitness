import type { SetData, Workout } from '@/types';

export type ProgressionStyle = 'double' | 'weight' | 'reps' | 'manual';

export interface ProgressionSuggestion {
  style: ProgressionStyle;
  summary: string;
  detail: string;
  suggestedWeight: number | null;
  suggestedReps: number | null;
  suggestedRepRange?: string;
  reason: 'hit_target' | 'near_target' | 'missed' | 'first' | 'manual';
}

const WEIGHT_STEPS_KG = [2.5, 5, 1.25];

function roundToStep(weight: number, step = 2.5): number {
  return Math.round(weight / step) * step;
}

function workingSets(sets: SetData[]): SetData[] {
  return sets.filter((s) => !s.isWarmup && (s.weight != null || s.reps != null));
}

function minReps(sets: SetData[]): number | null {
  const reps = workingSets(sets)
    .map((s) => s.reps)
    .filter((r): r is number => r != null && r > 0);
  if (reps.length === 0) return null;
  return Math.min(...reps);
}

function avgWeight(sets: SetData[]): number | null {
  const weights = workingSets(sets)
    .map((s) => s.weight)
    .filter((w): w is number => w != null && w > 0);
  if (weights.length === 0) return null;
  return weights.reduce((a, b) => a + b, 0) / weights.length;
}

/**
 * Suggest next targets from the last session's working sets.
 * Default philosophy: double progression (reps first, then weight).
 */
export function suggestProgression(
  previousSets: SetData[],
  style: ProgressionStyle = 'double',
  targetReps = 8
): ProgressionSuggestion | null {
  if (style === 'manual') {
    return {
      style,
      summary: 'Manual',
      detail: 'You choose the next target.',
      suggestedWeight: null,
      suggestedReps: null,
      reason: 'manual',
    };
  }

  const sets = workingSets(previousSets);
  if (sets.length === 0) {
    return {
      style,
      summary: 'First time',
      detail: 'Pick a weight you can do for 6–8 clean reps.',
      suggestedWeight: null,
      suggestedReps: targetReps,
      suggestedRepRange: '6–8',
      reason: 'first',
    };
  }

  const weight = avgWeight(sets) ?? sets[0].weight ?? 0;
  const worst = minReps(sets) ?? 0;
  const allHitTarget = sets.every((s) => (s.reps ?? 0) >= targetReps);
  const nearTarget = worst >= targetReps - 1;

  if (style === 'reps') {
    return {
      style,
      summary: `Stay at ${formatWeight(weight)}`,
      detail: allHitTarget
        ? `Try ${targetReps + 1}+ reps on each set.`
        : `Aim for ${targetReps} reps on every set.`,
      suggestedWeight: roundToStep(weight),
      suggestedReps: allHitTarget ? targetReps + 1 : targetReps,
      reason: allHitTarget ? 'hit_target' : nearTarget ? 'near_target' : 'missed',
    };
  }

  if (style === 'weight') {
    if (allHitTarget) {
      const next = roundToStep(weight + WEIGHT_STEPS_KG[0]);
      return {
        style,
        summary: `Try ${formatWeight(next)}`,
        detail: `Last session hit ${targetReps}+ across sets. Bump the weight.`,
        suggestedWeight: next,
        suggestedReps: Math.max(5, targetReps - 2),
        suggestedRepRange: `${Math.max(5, targetReps - 2)}–${targetReps}`,
        reason: 'hit_target',
      };
    }
    return {
      style,
      summary: `Stay at ${formatWeight(weight)}`,
      detail: `Hit ${targetReps} reps on all sets before increasing.`,
      suggestedWeight: roundToStep(weight),
      suggestedReps: targetReps,
      reason: nearTarget ? 'near_target' : 'missed',
    };
  }

  // Double progression (default)
  if (allHitTarget) {
    const next = roundToStep(weight + WEIGHT_STEPS_KG[0]);
    return {
      style: 'double',
      summary: `Next: ${formatWeight(next)} × ${Math.max(5, targetReps - 2)}–${targetReps}`,
      detail: `You hit ${targetReps} on all sets last time. Increase weight and rebuild reps.`,
      suggestedWeight: next,
      suggestedReps: Math.max(5, targetReps - 2),
      suggestedRepRange: `${Math.max(5, targetReps - 2)}–${targetReps}`,
      reason: 'hit_target',
    };
  }

  if (nearTarget) {
    return {
      style: 'double',
      summary: `Stay at ${formatWeight(weight)}`,
      detail: `Almost there — finish ${targetReps} × ${sets.length} before adding weight.`,
      suggestedWeight: roundToStep(weight),
      suggestedReps: targetReps,
      reason: 'near_target',
    };
  }

  return {
    style: 'double',
    summary: `Stay at ${formatWeight(weight)}`,
    detail: `Focus on form and build to ${targetReps} reps across sets.`,
    suggestedWeight: roundToStep(weight),
    suggestedReps: targetReps,
    reason: 'missed',
  };
}

function formatWeight(w: number): string {
  return Number.isInteger(w) ? `${w}` : w.toFixed(1);
}

/** Default rest seconds by rough exercise heuristic (compound vs isolation). */
export function suggestedRestSeconds(exerciseName: string, setType?: {
  isWarmup?: boolean;
  isDropset?: boolean;
  isFailure?: boolean;
}): number {
  if (setType?.isWarmup) return 45;
  if (setType?.isDropset) return 60;
  if (setType?.isFailure) return 150;

  const name = exerciseName.toLowerCase();
  const compound =
    /squat|deadlift|bench|press|row|pull.?up|chin.?up|overhead|clean|snatch|leg press|hip thrust/.test(
      name
    );
  const isolation =
    /curl|raise|fly|extension|pushdown|lateral|rear delt|calf|crunch|plank/.test(name);

  if (compound) return 180;
  if (isolation) return 75;
  return 90;
}

export function getRecentExerciseNames(workouts: Workout[], limit = 12): string[] {
  const seen = new Map<string, { count: number; lastAt: number; display: string }>();
  for (const w of workouts) {
    const t = Date.parse(w.startedAt) || 0;
    for (const ex of w.exercises) {
      const key = ex.name.trim().toLowerCase();
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { count: 1, lastAt: t, display: ex.name.trim() });
      } else {
        prev.count += 1;
        prev.lastAt = Math.max(prev.lastAt, t);
      }
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.lastAt - a.lastAt || b.count - a.count)
    .slice(0, limit)
    .map((v) => v.display);
}
