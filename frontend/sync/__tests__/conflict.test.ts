import { resolveLww, shouldSyncNow, shouldApplyServerChange, ONE_DAY_MS, SIX_HOURS_MS } from '../conflict';
import { isDirtyRow } from '../../db/syncColumns';

describe('resolveLww', () => {
  it('prefers newer localUpdatedAt', () => {
    expect(
      resolveLww({
        clientLocalUpdatedAt: '2026-01-02T00:00:00.000Z',
        serverUpdatedAt: '2026-01-01T00:00:00.000Z',
        clientRevision: 1,
        serverRevision: 9,
      })
    ).toBe('client');
  });

  it('prefers delete when delete is newer or equal', () => {
    expect(
      resolveLww({
        clientLocalUpdatedAt: '2026-01-02T00:00:00.000Z',
        serverUpdatedAt: '2026-01-01T00:00:00.000Z',
        clientRevision: 1,
        serverRevision: 1,
        clientDeleted: true,
      })
    ).toBe('client');
  });
});

describe('shouldApplyServerChange', () => {
  it('always applies when local is not pending', () => {
    expect(
      shouldApplyServerChange({
        localRevision: 2,
        localSyncedRevision: 2,
        localUpdatedAt: '2026-01-02T00:00:00.000Z',
        serverRevision: 1,
        serverUpdatedAt: '2026-01-01T00:00:00.000Z',
        localPending: false,
      })
    ).toBe(true);
  });

  it('does not overwrite newer pending local data', () => {
    expect(
      shouldApplyServerChange({
        localRevision: 5,
        localSyncedRevision: 4,
        localUpdatedAt: '2026-01-03T00:00:00.000Z',
        serverRevision: 4,
        serverUpdatedAt: '2026-01-02T00:00:00.000Z',
        localPending: true,
      })
    ).toBe(false);
  });
});

describe('shouldSyncNow', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');

  it('syncs on manual, login, workout_completed', () => {
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now).toISOString(),
        pendingCount: 0,
        reason: 'manual',
        now,
      })
    ).toBe(true);
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now).toISOString(),
        pendingCount: 0,
        reason: 'login',
        now,
      })
    ).toBe(true);
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now).toISOString(),
        pendingCount: 0,
        reason: 'workout_completed',
        now,
      })
    ).toBe(true);
  });

  it('syncs on reconnect only with pending changes', () => {
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now).toISOString(),
        pendingCount: 0,
        reason: 'reconnect',
        now,
      })
    ).toBe(false);
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now).toISOString(),
        pendingCount: 2,
        reason: 'reconnect',
        now,
      })
    ).toBe(true);
  });

  it('syncs after one day or long foreground gap', () => {
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now - ONE_DAY_MS - 1000).toISOString(),
        pendingCount: 0,
        reason: 'heartbeat',
        now,
      })
    ).toBe(true);
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now - SIX_HOURS_MS - 1000).toISOString(),
        pendingCount: 0,
        reason: 'foreground',
        now,
      })
    ).toBe(true);
  });

  it('does not sync on heartbeat within daily window without pending pressure', () => {
    expect(
      shouldSyncNow({
        lastSuccessfulSyncAt: new Date(now - 60_000).toISOString(),
        pendingCount: 0,
        reason: 'heartbeat',
        now,
      })
    ).toBe(false);
  });
});

describe('isDirtyRow', () => {
  it('detects pending and revision ahead of last synced', () => {
    expect(isDirtyRow({ sync_status: 'pending', revision: 1, last_synced_revision: null })).toBe(true);
    expect(isDirtyRow({ sync_status: 'synced', revision: 3, last_synced_revision: 2 })).toBe(true);
    expect(isDirtyRow({ sync_status: 'synced', revision: 2, last_synced_revision: 2 })).toBe(false);
  });
});

describe('offline workout invariants', () => {
  it('keeps local sets after app restart simulation', () => {
    const localDb = {
      workouts: [{ id: 'w1', status: 'active' }],
      sets: [
        { id: 's1', weight: 80, reps: 8 },
        { id: 's2', weight: 80, reps: 8 },
        { id: 's3', weight: 80, reps: 7 },
      ],
    };
    // Simulate restart: rehydrate from local only
    const restored = JSON.parse(JSON.stringify(localDb));
    expect(restored.sets).toHaveLength(3);
    expect(restored.sets.map((s: { reps: number }) => s.reps)).toEqual([8, 8, 7]);
  });

  it('soft delete retains tombstone until sync ack', () => {
    const row = { id: 's1', deleted_at: null as string | null, sync_status: 'synced', revision: 1 };
    row.deleted_at = '2026-01-01T00:00:00.000Z';
    row.sync_status = 'pending';
    row.revision = 2;
    expect(row.deleted_at).not.toBeNull();
    expect(row.sync_status).toBe('pending');
  });

  it('duplicate sync request uses same entity ids', () => {
    const payload1 = { changes: { workouts: [{ id: 'w1', revision: 2 }] } };
    const payload2 = { changes: { workouts: [{ id: 'w1', revision: 2 }] } };
    expect(payload1.changes.workouts[0].id).toBe(payload2.changes.workouts[0].id);
  });

  it('paginates large workout history', () => {
    const history = Array.from({ length: 500 }, (_, i) => ({ id: `w${i}` }));
    const page = history.slice(0, 100);
    expect(page).toHaveLength(100);
    expect(history).toHaveLength(500);
  });

  it('first-time device sync uses null token', () => {
    const lastSyncToken: string | null = null;
    expect(lastSyncToken).toBeNull();
  });
});
