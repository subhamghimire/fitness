import { resolveWinner, isIdempotentReplay } from "./sync-conflict.util";

describe("sync conflict resolution", () => {
  it("uses last-write-wins by timestamp", () => {
    expect(
      resolveWinner("2026-01-02T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"), 1, 5)
    ).toBe("client");
    expect(
      resolveWinner("2026-01-01T00:00:00.000Z", new Date("2026-01-02T00:00:00.000Z"), 9, 1)
    ).toBe("server");
  });

  it("breaks ties with revision then prefers server", () => {
    const t = "2026-01-01T00:00:00.000Z";
    expect(resolveWinner(t, new Date(t), 3, 2)).toBe("client");
    expect(resolveWinner(t, new Date(t), 2, 3)).toBe("server");
    expect(resolveWinner(t, new Date(t), 2, 2)).toBe("server");
  });

  it("prefers delete when delete is newer", () => {
    expect(
      resolveWinner("2026-01-02T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"), 2, 2, {
        clientDeleted: true
      })
    ).toBe("client");
  });

  it("detects idempotent replay of same revision", () => {
    expect(isIdempotentReplay(3, 3)).toBe(true);
    expect(isIdempotentReplay(3, 4)).toBe(false);
    expect(isIdempotentReplay(null, 1)).toBe(false);
  });
});
