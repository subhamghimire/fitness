import { resolveWinner, isIdempotentReplay } from "./sync-conflict.util";

describe("sync conflict resolution", () => {
  // ── LWW by client mutation time ──────────────────────────────────────────

  it("prefers higher clientUpdatedAt", () => {
    expect(resolveWinner("2026-01-02T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"), 1, 5)).toBe("client");
    expect(resolveWinner("2026-01-01T00:00:00.000Z", new Date("2026-01-02T00:00:00.000Z"), 9, 1)).toBe("server");
  });

  it("breaks ties with revision then prefers server", () => {
    const t = "2026-01-01T00:00:00.000Z";
    expect(resolveWinner(t, new Date(t), 3, 2)).toBe("client");
    expect(resolveWinner(t, new Date(t), 2, 3)).toBe("server");
    expect(resolveWinner(t, new Date(t), 2, 2)).toBe("server");
  });

  // ── Delete vs non-delete ─────────────────────────────────────────────────

  it("delete wins when client deletes and server has not", () => {
    // client delete is newer
    expect(
      resolveWinner("2026-01-02T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"), 2, 2, {
        clientDeleted: true,
        serverDeleted: false
      })
    ).toBe("client");
  });

  it("server wins when server deletes and client has not", () => {
    expect(
      resolveWinner("2026-01-01T00:00:00.000Z", new Date("2026-01-02T00:00:00.000Z"), 1, 1, {
        clientDeleted: false,
        serverDeleted: true
      })
    ).toBe("server");
  });

  it("delete vs update: delete wins if delete.clientUpdatedAt >= update.clientUpdatedAt", () => {
    // equal timestamps — delete wins
    expect(
      resolveWinner("2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"), 1, 1, {
        clientDeleted: true
      })
    ).toBe("client");

    // delete is older — update wins
    expect(
      resolveWinner("2026-01-01T00:00:00.000Z", new Date("2026-01-02T00:00:00.000Z"), 1, 1, {
        clientDeleted: true
      })
    ).toBe("server");
  });

  // ── Null / missing timestamps ────────────────────────────────────────────

  it("treats null existingClientUpdatedAt as epoch", () => {
    expect(resolveWinner("2026-01-01T00:00:00.000Z", null, 1, 1)).toBe("client");
  });

  it("treats null incoming as epoch", () => {
    expect(resolveWinner(null, new Date("2026-01-01T00:00:00.000Z"), 1, 1)).toBe("server");
  });

  it("treats both null as epoch, falls through to revision", () => {
    expect(resolveWinner(null, null, 5, 3)).toBe("client");
    expect(resolveWinner(null, null, 3, 5)).toBe("server");
    expect(resolveWinner(null, null, 3, 3)).toBe("server");
  });

  // ── Idempotent replay ────────────────────────────────────────────────────

  it("detects idempotent replay of same revision", () => {
    expect(isIdempotentReplay(3, 3)).toBe(true);
    expect(isIdempotentReplay(3, 4)).toBe(false);
    expect(isIdempotentReplay(null, 1)).toBe(false);
    expect(isIdempotentReplay(undefined, 1)).toBe(false);
  });

  it("same revision with the same logical mutation time is a replay", () => {
    expect(isIdempotentReplay(3, 3, new Date("2026-01-02T00:00:00.000Z"), "2026-01-02T00:00:00.000Z")).toBe(true);
  });

  it("same revision but a different mutation time is NOT an idempotent replay", () => {
    // Two devices independently bump a shared entity to revision 3; the timestamps
    // differ, so this is a real divergence and must surface as a conflict.
    expect(isIdempotentReplay(3, 3, new Date("2026-01-02T00:00:00.000Z"), "2026-01-03T00:00:00.000Z")).toBe(false);
  });

  // ── Late / out-of-order ──────────────────────────────────────────────────

  it("late push loses to already-accepted newer mutation", () => {
    // Server already accepted T2 mutation (clientUpdatedAt = T2).
    // Late push from another device arrives with T1 < T2.
    const serverStoredClientTime = new Date("2026-01-02T00:00:00.000Z");
    expect(resolveWinner("2026-01-01T00:00:00.000Z", serverStoredClientTime, 3, 2)).toBe("server");
  });

  it("out-of-order push: newer mutation wins regardless of arrival order", () => {
    // Device A pushes T3 (arrives first), Device B pushes T5 (arrives second).
    // After A is accepted, server has clientUpdatedAt=T3.
    // B's push: T5 > T3 → client wins.
    expect(resolveWinner("2026-01-05T00:00:00.000Z", new Date("2026-01-03T00:00:00.000Z"), 2, 1)).toBe("client");

    // Now B pushes again (duplicate at T5) but server already has T5.
    // Equal timestamps → revision tie-break → server wins.
    expect(resolveWinner("2026-01-05T00:00:00.000Z", new Date("2026-01-05T00:00:00.000Z"), 2, 2)).toBe("server");
  });
});
