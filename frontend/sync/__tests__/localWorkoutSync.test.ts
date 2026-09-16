import { initDatabase, resetDatabase } from '@/db/database';
import { newSyncDefaults } from '@/db/syncColumns';
import { collectDirtyChanges } from '@/sync/dirty';
import { applyServerChanges } from '@/sync/applyServerChanges';
import { countPendingChanges } from '@/db/queries';
import { WorkoutRepository } from '@/repositories/workout.repository';
import type { SyncBatchChanges, SyncChangeItem } from '@/types';

const sqliteMock = require('./mocks/expo-sqlite.js');

beforeEach(async () => {
  sqliteMock.__reset();
  await initDatabase();
  await resetDatabase();
});

function seedTree(status: 'active' | 'completed', idPrefix: string) {
  const now = new Date().toISOString();
  const wId = `${idPrefix}-w`;
  const exId = `${idPrefix}-ex`;
  const setId = `${idPrefix}-set`;
  const sync = newSyncDefaults();

  return WorkoutRepository.insert(
    WorkoutRepository.createLocalWorkoutRow({ id: wId, status, started_at: now })
  ).then(async () => {
    await WorkoutRepository.insertExercise({ id: exId, workout_id: wId, name: 'Bench Press', order_index: 0, notes: null, rest_seconds: 90, ...sync });
    await WorkoutRepository.insertSet({ id: setId, exercise_id: exId, order_index: 0, weight: 100, reps: 5, is_warmup: 0, is_dropset: 0, is_failure: 0, is_completed: 1, ...sync });
    if (status === 'completed') {
      await WorkoutRepository.update(wId, { status: 'completed', ended_at: new Date(Date.parse(now) + 3600_000).toISOString() });
    }
    return { wId, exId, setId };
  });
}

function serverEchoFor(rows: SyncBatchChanges, status: 'active' | 'completed'): SyncBatchChanges {
  const workout = rows.workouts[0]?.payload as Record<string, unknown> | undefined;
  return {
    workouts: rows.workouts.map((i): SyncChangeItem => ({
      ...i,
      clientUpdatedAt: (workout?.clientUpdatedAt as string) ?? '',
      payload: {
        id: workout?.id,
        name: workout?.name ?? null,
        notes: workout?.notes ?? null,
        startedAt: workout?.startedAt,
        endedAt:
          status === 'active'
            ? null
            : ((workout?.endedAt as string) ?? (workout?.startedAt as string)),
        revision: workout?.revision ?? 1,
        serverUpdatedAt: new Date().toISOString(),
        clientUpdatedAt: workout?.clientUpdatedAt ?? null,
        deletedAt: null,
      },
    })),
    workoutExercises: [],
    sets: [],
    templates: [],
    templateExercises: [],
    templateSets: [],
  };
}

describe('sync dirty collection — locally created workouts', () => {
  it('collects an ACTIVE (started, not yet finished) workout tree as pending changes', async () => {
    await seedTree('active', 'act');

    const changes = await collectDirtyChanges(200);

    expect(changes.workouts.map((w) => w.id)).toContain('act-w');
    expect(changes.workoutExercises.map((e) => e.id)).toContain('act-ex');
    expect(changes.sets.map((s) => s.id)).toContain('act-set');
    expect(await countPendingChanges()).toBeGreaterThanOrEqual(3);
  });

  it('keeps a still-active workout ACTIVE when its own push is applied back', async () => {
    const ids = await seedTree('active', 'self');
    const changes = await collectDirtyChanges(200);
    const echo = serverEchoFor(changes, 'active');

    await applyServerChanges(echo);

    const row = await initDatabase().then(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('@/db/database').getDatabase() as any).getFirstAsync(
        `SELECT status, sync_status, last_synced_revision FROM workouts_local WHERE id = ?`,
        [ids.wId]
      )
    );
    expect(row.status).toBe('active');
    expect(row.sync_status).toBe('synced');
    expect(row.last_synced_revision).toBe(1);
  });

  it('still collects a COMPLETED workout tree as pending changes (no regression)', async () => {
    await seedTree('completed', 'cmp');

    const changes = await collectDirtyChanges(200);

    expect(changes.workouts.map((w) => w.id)).toContain('cmp-w');
    expect(changes.workoutExercises.map((e) => e.id)).toContain('cmp-ex');
    expect(changes.sets.map((s) => s.id)).toContain('cmp-set');
  });
});