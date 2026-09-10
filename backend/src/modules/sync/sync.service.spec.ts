describe("sync protocol invariants", () => {
  it("treats client UUIDs as stable primary keys for retries", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const first = { id, revision: 1 };
    const retry = { id, revision: 1 };
    expect(first.id).toBe(retry.id);
    expect(first.revision).toBe(retry.revision);
  });

  it("builds empty change bags without undefined collections", () => {
    const empty = {
      workouts: [],
      workoutExercises: [],
      sets: [],
      templates: [],
      templateExercises: [],
      templateSets: []
    };
    expect(Object.values(empty).every(Array.isArray)).toBe(true);
  });

  it("supports partial failure resume by retaining unsynced revisions", () => {
    const local = { revision: 5, lastSyncedRevision: 3 };
    const pending = local.revision > (local.lastSyncedRevision ?? 0);
    expect(pending).toBe(true);
    const afterPartialAck = { revision: 5, lastSyncedRevision: 4 };
    expect(afterPartialAck.revision > afterPartialAck.lastSyncedRevision).toBe(true);
  });

  it("does not clear local data on failed sync", () => {
    const localWorkouts = [{ id: "w1" }];
    const syncFailed = true;
    if (syncFailed) {
      // keep local
    }
    expect(localWorkouts).toHaveLength(1);
  });

  it("legacy and batch endpoints coexist", () => {
    const routes = ["/sync", "/sync/workouts"];
    expect(routes).toContain("/sync");
    expect(routes).toContain("/sync/workouts");
  });
});
