import { estimate1RM, getWeeklySummary, detectNewPRs } from '../prs';
import type { Workout, SetData } from '@/types';

function workout(partial: Partial<Workout> & Pick<Workout, 'id' | 'startedAt' | 'exercises'>): Workout {
  return {
    status: 'completed',
    endedAt: null,
    lastSyncedAt: null,
    syncStatus: 'synced',
    revision: 1,
    ...partial,
  };
}

function working(weight: number, reps: number, id: string): SetData {
  return {
    id,
    exerciseId: 'e',
    orderIndex: 0,
    weight,
    reps,
    isWarmup: false,
    isDropset: false,
    isFailure: false,
    isCompleted: true,
  };
}

describe('estimate1RM', () => {
  it('returns weight for 1 rep', () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });

  it('estimates higher for multi-rep sets', () => {
    expect(estimate1RM(80, 8)).toBeGreaterThan(80);
  });
});

describe('detectNewPRs', () => {
  it('flags heavier weight as PR', () => {
    const history = [
      workout({
        id: 'old',
        startedAt: '2026-01-01T00:00:00.000Z',
        exercises: [
          {
            id: 'e1',
            workoutId: 'old',
            name: 'Bench',
            orderIndex: 0,
            sets: [working(80, 5, 's1')],
          },
        ],
      }),
    ];
    const prs = detectNewPRs({
      exerciseName: 'Bench',
      currentSets: [working(85, 5, 's2')],
      history,
      currentWorkoutId: 'new',
      unit: 'kg',
    });
    expect(prs.some((p) => p.kind === 'heaviest_weight')).toBe(true);
  });
});

describe('getWeeklySummary', () => {
  it('counts this week workouts', () => {
    const now = new Date();
    const recent = workout({
      id: 'w1',
      startedAt: now.toISOString(),
      exercises: [
        {
          id: 'e1',
          workoutId: 'w1',
          name: 'Squat',
          orderIndex: 0,
          sets: [working(100, 5, 's1')],
        },
      ],
    });
    const summary = getWeeklySummary([recent]);
    expect(summary.workouts).toBe(1);
    expect(summary.workingSets).toBe(1);
    expect(summary.volume).toBe(500);
  });
});
