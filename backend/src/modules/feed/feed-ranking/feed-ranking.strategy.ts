import { SelectQueryBuilder } from "typeorm";
import { Post } from "src/modules/posts/entities";

/**
 * FEED RANKING — THE SEAM THAT MAKES RANKING EVOLVABLE
 * ---------------------------------------------------------------------------
 * A ranking strategy answers three questions about one ordering, and nothing
 * else. It is a deliberately tiny interface, because every method on it is a
 * promise that has to hold for *both* halves of a cursor page:
 *
 *   1. `applyOrdering`   — how rows are sorted in SQL.
 *   2. `seek`            — given the sort-key values of the last row the client
 *                          is holding, which rows come *after* it.
 *   3. `cursorKeys`      — given a row, the sort-key values to put in the next
 *                          cursor.
 *
 * ─── Why this is an interface and not a `switch` in the feed service ─────────
 * The two halves must agree exactly. If ordering and seeking were written in two
 * places, changing one without the other produces a feed that *looks* fine for
 * the first page and then silently repeats or drops posts at page boundaries —
 * the single worst failure mode a paginated feed has, and one that no amount of
 * manual testing reliably catches because it only appears on page two.
 *
 * Binding them into one object makes the pair a single unit of change: a new
 * ranking is a new class, and the compiler will not let you ship it with only
 * half of it written. It also gives each strategy a stable `id` that is embedded
 * in every cursor it mints, so a cursor issued under one ordering is *rejected*
 * rather than misinterpreted when a client switches strategy mid-pagination.
 *
 * ─── The contract a strategy must satisfy ───────────────────────────────────
 * **The ordering must be total.** Every row must have a distinct position. In
 * practice that means the last sort key has to be `id` (or something equally
 * unique), because `created_at` alone collides — two posts written in the same
 * transaction share a timestamp, and a tie that straddles a page boundary means
 * one post is dropped forever and another is served twice. Every implementation
 * here ends with `id`.
 *
 * **`seek` and `applyOrdering` must be exact inverses.** For the row at the
 * cursor, `seek` must be false; for every row strictly after it in
 * `applyOrdering` order, `seek` must be true. That is the property the keyset
 * pagination in `common/social/social-cursor.ts` depends on, and it is why
 * `seek` is expressed as a row-tuple comparison and not as a disjunction.
 *
 * **No strategy may change what is *visible*.** Scope, blocks, privacy and soft
 * deletion are applied by `PostVisibilityService` before a strategy sees the
 * query. A ranking is an ordering, never a filter — otherwise "why is this post
 * missing?" becomes answerable only by reading the ranker's code.
 *
 * ─── Adding a ranking later ─────────────────────────────────────────────────
 * Implement this interface, register it in `FeedRankingRegistry`, and add one
 * entry to the migration if it needs a new index. `FeedService` does not change.
 * A strategy that is cheap today can be replaced by a better one tomorrow, and
 * clients mid-pagination across the switch get a 400 telling them to restart
 * rather than a scrambled feed.
 */
export interface FeedRankingStrategy {
  /**
   * Stable, URL-safe identifier. It is embedded in every cursor this strategy
   * mints (`SocialCursor.s`) and is therefore part of the API contract: renaming
   * one invalidates in-flight cursors. Rename deliberately, never casually.
   */
  readonly id: string;

  /** Human-readable summary, surfaced in API docs so the options are legible. */
  readonly description: string;

  /**
   * Appends the ordering to a query. Must end with a unique column so the order
   * is total.
   */
  applyOrdering(qb: SelectQueryBuilder<Post>): void;

  /**
   * Adds the keyset predicate that resumes *after* the cursor's boundary row.
   *
   * `keys` are the stringified sort-key values produced by {@link cursorKeys},
   * in the strategy's key order. Implementations must be total: a wrong arity is
   * a 400, never a silently wrong page.
   */
  seek(qb: SelectQueryBuilder<Post>, keys: string[]): void;

  /** The sort-key values for a row, in the same order {@link seek} expects. */
  cursorKeys(post: Post): string[];
}
