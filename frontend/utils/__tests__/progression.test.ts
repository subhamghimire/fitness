import { suggestProgression, suggestedRestSeconds, getRecentExerciseNames } from '../progression';
import type { SetData, Workout } from '@/types';

function set(partial: Partial<SetData> & Pick<SetData, 'id'>): SetData {
  return {
    exerciseId: 'e1',
    orderIndex: 0,
    weight: 80,
    reps: 8,
    isWarmup: false,
    isDropset: false,
    isFailure: false,
    isCompleted: true,
    ...partial,
  };
}

describe('suggestProgression', () => {
  it('suggests weight bump on double progression when all sets hit target', () => {
    const prev = [set({ id: '1', reps: 8 }), set({ id: '2', reps: 8 }), set({ id: '3', reps: 8 })];
    const s = suggestProgression(prev, 'double', 8);
    expect(s?.reason).toBe('hit_target');
    expect(s?.suggestedWeight).toBe(82.5);
  });

  it('stays at weight when reps missed', () => {
    const prev = [set({ id: '1', reps: 8 }), set({ id: '2', reps: 8 }), set({ id: '3', reps: 6 })];
    const s = suggestProgression(prev, 'double', 8);
    expect(s?.reason).toBe('missed');
    expect(s?.suggestedWeight).toBe(80);
    expect(s?.summary).toMatch(/Stay/);
  });

  it('respects manual style', () => {
    const s = suggestProgression([set({ id: '1' })], 'manual');
    expect(s?.reason).toBe('manual');
    expect(s?.suggestedWeight).toBeNull();
  });

  it('reps style stays at weight and raises target after hit', () => {
    const prev = [set({ id: '1', reps: 8 }), set({ id: '2', reps: 8 })];
    const s = suggestProgression(prev, 'reps', 8);
    expect(s?.suggestedWeight).toBe(80);
    expect(s?.suggestedReps).toBe(9);
  });
});

describe('suggestedRestSeconds', () => {
  it('gives longer rest for compounds', () => {
    expect(suggestedRestSeconds('Barbell Bench Press')).toBeGreaterThan(
      suggestedRestSeconds('Cable Lateral Raise')
    );
  });

  it('shortens warmup rest', () => {
    expect(suggestedRestSeconds('Squat', { isWarmup: true })).toBe(45);
  });
});

describe('getRecentExerciseNames', () => {
  it('orders by recency', () => {
    const workouts = [
      {
        id: 'w1',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: null,
        lastSyncedAt: null,
        syncStatus: 'synced',
        revision: 1,
        exercises: [{ id: 'e1', workoutId: 'w1', name: 'Squat', orderIndex: 0, sets: [] }],
      },
      {
        id: 'w2',
        status: 'completed',
        startedAt: '2026-02-01T00:00:00.000Z',
        endedAt: null,
        lastSyncedAt: null,
        syncStatus: 'synced',
        revision: 1,
        exercises: [{ id: 'e2', workoutId: 'w2', name: 'Bench Press', orderIndex: 0, sets: [] }],
      },
    ] as Workout[];
    expect(getRecentExerciseNames(workouts, 5)[0]).toBe('Bench Press');
  });
});
