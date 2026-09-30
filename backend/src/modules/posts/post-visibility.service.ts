import { Injectable, NotFoundException } from "@nestjs/common";
import { SelectQueryBuilder } from "typeorm";
import { SocialGraphService } from "src/modules/follows/social-graph.service";
import { PostPrivacy } from "./enums";
import { Post } from "./entities";

/**
 * Everything needed to decide visibility, resolved once per request.
 *
 * The two id sets come from `SocialGraphService` (Redis-cached), so a request
 * pays for them at most once no matter how many posts it is judging.
 */
export interface PostVisibilityContext {
  viewerId: string;
  /** Live follow edges viewer → author. Drives the FOLLOWERS tier. */
  followingIds: string[];
  /** Mutual blocks in both directions. Always subtracts, including from PUBLIC. */
  blockedIds: string[];
}

/** Why a post was not visible. Used for logs; never returned to the client. */
export type PostHiddenReason = "deleted" | "private" | "not_a_follower" | "blocked";

/**
 * POST VISIBILITY
 * ---------------------------------------------------------------------------
 * The one place that knows who may see a post. Both the point read
 * (`PostsService.getOne`) and the list reads (`PostsService.list*`, and the feed
 * in FeedModule) go through here, in one of two forms:
 *
 *   - {@link canView} for a post that has already been loaded, and
 *   - {@link buildScopePredicate} for a query that has not been executed yet.
 *
 * Having exactly one implementation *per form* is deliberate and is the reason
 * this class exists. The tempting alternative — filtering after loading — is
 * wrong in a way that is easy to miss: it makes a keyset page return fewer than
 * `limit` rows (the client sees a short page and thinks it reached the end), and
 * on a followers-only profile it makes the cursor jump over invisible posts. The
 * visibility rule has to be part of the query.
 *
 * ─── The rule, in full ──────────────────────────────────────────────────────
 * 1. Your own posts are always visible to you — including a private one, and
 *    including one you have been blocked over. Otherwise a user who blocks you
 *    would also blind *you*, which is a bug that looks like censorship.
 * 2. Otherwise the author must not be in your blocked set (either direction).
 *    This applies to PUBLIC posts too: a block that let public content through
 *    is not a block.
 * 3. PUBLIC — visible.
 * 4. FOLLOWERS — visible only if you hold a live follow edge to the author.
 * 5. PRIVATE — never visible to anyone but the author.
 *
 * ─── Why the SQL and the TypeScript forms are written out separately ─────────
 * They are the same five rules in two languages, and a comment on each line
 * cross-references the other. That is duplication, and it is accepted: the two
 * forms exist because one is executed by Postgres and the other by the process,
 * and collapsing them (fetch-then-filter, or a single SQL fragment nobody can
 * evaluate for a loaded row) trades a small, reviewable duplication for one of
 * the two bugs above.
 */
@Injectable()
export class PostVisibilityService {
  constructor(private readonly graph: SocialGraphService) {}

  /** Resolves the graph projections a request needs, once. */
  async contextFor(viewerId: string): Promise<PostVisibilityContext> {
    const [followingIds, blockedIds] = await Promise.all([this.graph.followingIds(viewerId), this.graph.blockedUserIds(viewerId)]);
    return { viewerId, followingIds, blockedIds };
  }

  /** TypeScript mirror of {@link buildScopePredicate}, for an already-loaded post. */
  canView(post: Post, ctx: PostVisibilityContext): { visible: boolean; reason?: PostHiddenReason } {
    // (1) own post — even if deleted, so an author can see the tombstone and
    // understand why it vanished from their profile.
    if (post.authorId === ctx.viewerId) return { visible: true };
    if (post.isDeleted) return { visible: false, reason: "deleted" };
    // (2) block, either direction, overrides visibility.
    if (ctx.blockedIds.includes(post.authorId)) return { visible: false, reason: "blocked" };
    // (3) public
    if (post.privacy === PostPrivacy.PUBLIC) return { visible: true };
    // (4) followers
    if (post.privacy === PostPrivacy.FOLLOWERS) {
      return ctx.followingIds.includes(post.authorId) ? { visible: true } : { visible: false, reason: "not_a_follower" };
    }
    // (5) private
    return { visible: false, reason: "private" };
  }

  /**
   * 404 for anything not visible.
   *
   * Not 403, deliberately: a 403 confirms the post exists, which turns the post
   * id space into an oracle for confirming that a specific person posted
   * something — which is exactly what a blocked or stalking user wants. "No such
   * post" and "not your post" must be indistinguishable.
   */
  assertViewable(post: Post, ctx: PostVisibilityContext): void {
    if (!this.canView(post, ctx).visible) throw new NotFoundException("Post not found");
  }

  /**
   * The SQL form of the same five rules, for a query builder.
   *
   * Two implementation details that are easy to get wrong and are commented
   * inline: empty `IN` lists (a follower-less viewer must not produce `IN ()`,
   * which is a syntax error in Postgres) and the fact that the block exclusion
   * sits *inside* the non-owner branch so rule (1) still holds.
   */
  buildScopePredicate(ctx: PostVisibilityContext, alias = "post", prefix = "pv"): { sql: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = { [`${prefix}_viewer`]: ctx.viewerId, [`${prefix}_public`]: PostPrivacy.PUBLIC, [`${prefix}_followers`]: PostPrivacy.FOLLOWERS };

    // Not-in: an empty blocked set excludes nobody, and `NOT IN (NULL)` is a
    // trap in SQL, so the empty case short-circuits to a tautology.
    const notBlocked = ctx.blockedIds.length === 0 ? "1 = 1" : `${alias}.authorId NOT IN (:...${prefix}_blocked)`;
    if (ctx.blockedIds.length > 0) params[`${prefix}_blocked`] = ctx.blockedIds;

    // In: an empty follow set means the FOLLOWERS branch can never match.
    const followsAuthor = ctx.followingIds.length === 0 ? "1 = 0" : `${alias}.authorId IN (:...${prefix}_following)`;
    if (ctx.followingIds.length > 0) params[`${prefix}_following`] = ctx.followingIds;

    const sql = `(${alias}.authorId = :${prefix}_viewer OR (${notBlocked} AND (${alias}.privacy = :${prefix}_public OR (${alias}.privacy = :${prefix}_followers AND ${followsAuthor}))))`;
    return { sql, params };
  }

  /** Convenience wrapper that appends the scope to an existing query. */
  applyScope(qb: SelectQueryBuilder<Post>, ctx: PostVisibilityContext, alias = "post", prefix = "pv"): SelectQueryBuilder<Post> {
    const { sql, params } = this.buildScopePredicate(ctx, alias, prefix);
    return qb.andWhere(sql, params);
  }
}
