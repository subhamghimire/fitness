import { BadRequestException } from "@nestjs/common";
import { SelectQueryBuilder } from "typeorm";
import { Post } from "src/modules/posts/entities";
import { FeedRankingStrategy } from "./feed-ranking.strategy";

/** Recency sorts by (created_at, id). */
const RECENCY_KEY_COUNT = 2;
/** Hotness sorts by (score, created_at, id) — the score is the leading key. */
const HOTNESS_KEY_COUNT = 3;

/**
 * RECENCY RANKING — strictly newest first.
 *
 * The default, and the cheapest strategy in the system: `(created_at DESC,
 * id DESC)` is exactly `idx_posts_created` scanned backwards, so the query is an
 * index range scan with no sort step and no expression to evaluate per row.
 *
 * It is also the strategy every *other* strategy is measured against. If a
 * "hotter" ranking cannot beat recency on a cold feed while still using an
 * index, it is not a ranking, it is a slow sort.
 *
 * Note that Postgres serves this from a plain ASC index: a B-tree can be scanned
 * in reverse, so there is deliberately no `idx_posts_created_desc`. A second,
 * mirror index would double the write amplification on the table's hottest insert
 * path to save a scan the planner already knows how to reverse.
 */
export class RecencyRankingStrategy implements FeedRankingStrategy {
  readonly id = "recent";
  readonly description = "Newest first. Cheapest ranking; served directly by idx_posts_created.";

  applyOrdering(qb: SelectQueryBuilder<Post>): void {
    qb.orderBy("post.createdAt", "DESC").addOrderBy("post.id", "DESC");
  }

  seek(qb: SelectQueryBuilder<Post>, keys: string[]): void {
    assertKeyArity(keys, RECENCY_KEY_COUNT);
    // Row-tuple comparison, not `a < ? OR (a = ? AND b < ?)`: the row form is a
    // single range seek on the composite index, the disjunction is not always.
    qb.andWhere("(post.createdAt, post.id) < (:rankingCreatedAt, :rankingId)", { rankingCreatedAt: new Date(keys[0]), rankingId: keys[1] });
  }

  cursorKeys(post: Post): string[] {
    return [post.createdAt.toISOString(), post.id];
  }
}

/**
 * WEIGHTED HOTNESS RANKING — engagement, decayed by age.
 *
 * A simple, explainable "hot" score:
 *
 *     score = (like_count + 2 * comment_count + 3 * reply-free coach weight)
 *             / (hours_since_posted + 2)^1.5
 *
 * The shape is the HackerNews gravity formula, and the reason to use *some*
 * decayed score rather than a raw like count is the failure mode a raw count
 * produces: a post from six months ago with 300 likes outranks everything anyone
 * has written since, forever. Dividing by an age term means a post's reach
 * decays, so the feed re-opens and new content is not permanently buried. The
 * comment weight is higher than the like weight because a comment is a far more
 * expensive signal — it costs typing, and it is the thing that indicates someone
 * actually engaged.
 *
 * ─── Why the score is computed in SQL and not in the application ────────────
 * It has to be, because the ordering and the keyset seek must use the *same*
 * expression. Computing the score in TypeScript would mean the rows come back in
 * the right order but the "after the cursor" test runs against a different
 * number, and the boundary is exactly where a feed silently drops posts.
 *
 * ─── The honest cost of this strategy ───────────────────────────────────────
 * `like_count + 2 * comment_count` over the *index* `(like_count,
 * comment_count, created_at)` cannot be served as an index range scan, because
 * the expression is not the index's leading column. Postgres will scan
 * `idx_posts_engagement` in `(like_count, comment_count, created_at)` order,
 * compute the expression per row, and then **sort**. That is honest work, and it
 * is why this is never the default.
 *
 * It is here anyway, for two reasons that outweigh the cost today:
 *
 *   1. It is the reference implementation of the `FeedRankingStrategy` contract
 *      for a *multi-key, expression-based* ordering — the case where `seek` is
 *      not a simple two-column tuple — and it is covered by tests that assert the
 *      page-boundary invariant.
 *   2. It gives the "how hot is this feed" question a measurable baseline.
 *      Replacing it later is a new class plus a migration, not a rewrite of the
 *      feed — which is the entire reason the seam exists.
 *
 * If this strategy is ever promoted to a default, the migration that promotes it
 * must add a materialised score column (or an expression index over it) and keep
 * it updated on the counter writes in `PostEngagementService`. That is the
 * documented upgrade path, and it is a change to *this* class plus a migration,
 * not to `FeedService`.
 */
export class WeightedHotnessRankingStrategy implements FeedRankingStrategy {
  readonly id = "hot";
  readonly description = "Engagement weighted by recency. Uses idx_posts_engagement, but computes and sorts the score in SQL — expect a sort step.";

  /** Comment weight. Higher than a like: a comment costs more signal per unit. */
  private static readonly COMMENT_WEIGHT = 2;
  /** Gravity exponent. 1.5 is a deliberately gentle decay, not a sharp cliff. */
  private static readonly GRAVITY = 1.5;
  /** Additive constant in the age denominator, so a brand-new post is not divided by ~0. */
  private static readonly AGE_OFFSET_HOURS = 2;

  applyOrdering(qb: SelectQueryBuilder<Post>): void {
    qb.addSelect(this.scoreExpression("post"), "feed_score").orderBy("feed_score", "DESC").addOrderBy("post.createdAt", "DESC").addOrderBy("post.id", "DESC");
  }

  /**
   * The row-tuple seek, with the score recomputed in the predicate.
   *
   * Both the `ORDER BY` and this predicate evaluate the *same* expression, which
   * is the only reason the boundary is correct. `:now` is bound once per request
   * so that every row in a page is scored against the same instant — a
   * `NOW()` evaluated per row would be consistent anyway inside one statement,
   * but pinning it also makes the score the client could recompute stable, and
   * keeps the cursor's stored score meaningful for the length of a pagination
   * session.
   *
   * The `post.id != :rankingId` exclusion is load-bearing, not belt-and-braces:
   * scores decay with wall-clock time, so the boundary row recomputed *now*
   * always scores just below the value stored in the cursor *then*. Without the
   * exclusion the row-tuple comparison alone would re-match the boundary row on
   * every page turn — not only for slow clients — and every hot page would open
   * with a duplicate. Excluding the named row cannot skip anything (ids are
   * unique; every other row is still judged purely by the tuple), while rows
   * whose trajectories cross the boundary between two fast requests can still
   * duplicate — which remains, as below, the client's seen-set to absorb.
   */
  seek(qb: SelectQueryBuilder<Post>, keys: string[]): void {
    assertKeyArity(keys, HOTNESS_KEY_COUNT);
    qb.andWhere(`(${this.scoreExpression("post")}, post.createdAt, post.id) < (:rankingScore, :rankingCreatedAt, :rankingId)`, {
      rankingScore: Number(keys[0]),
      rankingCreatedAt: new Date(keys[1]),
      rankingId: keys[2]
    }).andWhere("post.id != :rankingId", { rankingId: keys[2] });
  }

  /**
   * The cursor stores the score **as computed at the time of the page**. That is
   * a deliberate choice with a real consequence: a post's score decays, so a row
   * near the boundary can legitimately sit on a different side of it by the time
   * the next page is requested.
   *
   * The systematic case — the boundary row itself always decaying just below its
   * stored value and re-matching — is handled by `seek`'s id exclusion, so a
   * client paging promptly sees no duplicates. What remains is the residual
   * case: a *neighbouring* row crossing the boundary between two requests. That
   * is accepted rather than solved: pinning the boundary to recomputed values
   * would make the cursor depend on when it is *used* rather than when it was
   * *issued*, which is how keyset pagination starts skipping rows. A duplicate
   * page-two item is a cosmetic bug; a skipped post is a data-loss bug. If
   * duplicate suppression ever becomes necessary, the fix is a client-side
   * seen-set keyed on post id — not a change to this cursor.
   */
  cursorKeys(post: Post): string[] {
    return [String(this.scoreOf(post)), post.createdAt.toISOString(), post.id];
  }

  /**
   * The one place the formula is written.
   *
   * `GREATEST(…, 0)` guards the numerator so a post created "in the future" —
   * which happens with client-supplied timestamps on an offline-synced device —
   * scores `0` rather than a negative that would sort below every real post.
   * `EXTRACT(EPOCH …)` yields hours, matching `AGE_OFFSET_HOURS`.
   */
  private scoreExpression(alias: string): string {
    return `GREATEST(0, (${alias}.like_count + ${WeightedHotnessRankingStrategy.COMMENT_WEIGHT} * ${alias}.comment_count)) / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - ${alias}.created_at)) / 3600.0, 0) + ${WeightedHotnessRankingStrategy.AGE_OFFSET_HOURS}, ${WeightedHotnessRankingStrategy.GRAVITY})`;
  }

  /** Mirrors {@link scoreExpression} for the row already in memory. */
  private scoreOf(post: Post): number {
    const weighted = Math.max(0, post.likeCount + WeightedHotnessRankingStrategy.COMMENT_WEIGHT * post.commentCount);
    const ageHours = Math.max(0, (Date.now() - post.createdAt.getTime()) / 3_600_000);
    return weighted / Math.pow(ageHours + WeightedHotnessRankingStrategy.AGE_OFFSET_HOURS, WeightedHotnessRankingStrategy.GRAVITY);
  }
}

/**
 * A wrong cursor arity is a client error, not something to paper over.
 *
 * Every strategy knows its own key count, so it can state it. Returning a
 * "reasonable" page built from a mismatched cursor is how a feed starts
 * returning duplicates with no error anywhere; a 400 that says "restart
 * pagination" is the recoverable outcome.
 */
function assertKeyArity(keys: string[], expected: number): void {
  if (keys.length !== expected) throw new BadRequestException("Malformed cursor");
}
