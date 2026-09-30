import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Post } from "./entities";

/** How many rows a counter statement actually changed. */
export interface CounterUpdateResult {
  /** False when the post was missing, soft-deleted, or the predicate excluded it. */
  updated: boolean;
}

/**
 * POST ENGAGEMENT COUNTERS
 * ---------------------------------------------------------------------------
 * The only writer of `posts.like_count` and `posts.comment_count`. `LikesModule`
 * and `CommentsModule` own *their* rows; they ask this service to move the
 * numbers on the post, and they do it on their own `EntityManager` so the fact
 * row and the counter commit together.
 *
 * ─── Why the counter lives here and not in the like/comment services ─────────
 * Three reasons, all of them about there being exactly one way to do it:
 *
 *   1. **Atomicity.** A like that is committed without its counter is a
 *      permanent, invisible inconsistency. Both the fact row and the counter
 *      move inside one transaction supplied by the caller, so neither can be
 *      observed without the other. Splitting the UPDATE into a second service
 *      call on the default connection would reintroduce exactly that window.
 *   2. **One clamp, one expression.** A like insert, a like removal and a
 *      comment removal all need "never go below zero, never re-count a row that
 *      was not there". That is a `GREATEST(0, …)` and a `WHERE isDeleted =
 *      false` predicate, duplicated once here instead of three times.
 *   3. **It keeps the post row owned by the post module.** `LikesModule` and
 *      `CommentsModule` never register the `Post` repository, so the arrow stays
 *      one-way (`likes ──▶ posts`) and there is no second code path that can
 *      write a post row.
 *
 * ─── Why `GREATEST(0, …)` and not an application-side recount ───────────────
 * Recounting (`UPDATE … SET like_count = (SELECT count(*) …)`) is self-healing
 * but is a correlated subquery per write, and it turns the hot path — a like on a
 * popular post — into something that scales with the post's engagement. The
 * increment is O(1) on the primary key. The CHECK constraints in the migration
 * are the backstop that keeps the "0 floor" true even if this arithmetic is ever
 * wrong: a negative counter is a database error, not a client-visible number.
 */
@Injectable()
export class PostEngagementService {
  /** Adjusts `like_count` by `delta` (±1). Runs on the caller's transaction. */
  async adjustLikes(manager: EntityManager, postId: string, delta: number): Promise<CounterUpdateResult> {
    return this.adjust(manager, "likeCount", postId, delta);
  }

  /** Adjusts `comment_count` by `delta` (±1). Runs on the caller's transaction. */
  async adjustComments(manager: EntityManager, postId: string, delta: number): Promise<CounterUpdateResult> {
    return this.adjust(manager, "commentCount", postId, delta);
  }

  /**
   * One conditional UPDATE.
   *
   * The `value () => …` form is what makes this a single round trip: the new
   * value is computed by Postgres from the row's own current value, so two
   * concurrent likes both read the same starting number and each still adds one.
   * Doing read-modify-write in the process would lose one of the two.
   *
   * The `isDeleted = false` predicate is also a correctness guard, not just
   * hygiene: a post that was removed between the like read and the counter bump
   * must not have its counter moved, and the returned `updated: false` is what
   * lets the caller notice.
   */
  private async adjust(manager: EntityManager, column: "likeCount" | "commentCount", postId: string, delta: number): Promise<CounterUpdateResult> {
    const result = await manager
      .createQueryBuilder()
      .update(Post)
      .set({ [column]: () => `GREATEST(0, "${toColumnName(column)}" + ${Number(delta)})` })
      .where("id = :postId", { postId })
      .andWhere('"isDeleted" = false')
      .execute();
    return { updated: (result.affected ?? 0) > 0 };
  }
}

/** Maps the entity property to its column name for use inside raw SQL. */
function toColumnName(property: "likeCount" | "commentCount"): string {
  return property === "likeCount" ? "like_count" : "comment_count";
}
