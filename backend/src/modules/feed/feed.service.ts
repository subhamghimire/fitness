import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, SelectQueryBuilder } from "typeorm";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, SOCIAL_REDIS_KEYS, SOCIAL_CACHE_TTL, toCursorPage } from "src/common/social";
import { SocialCacheService } from "src/shared/social";
import { Post } from "src/modules/posts/entities";
import { PostHydrator } from "src/modules/posts/post-hydrator.service";
import { PostVisibilityContext, PostVisibilityService } from "src/modules/posts/post-visibility.service";
import { FeedRankingRegistry, FeedRankingStrategy } from "./feed-ranking";
import { FeedPageResponseDto, FeedQueryDto } from "./dto";
import { DEFAULT_FEED_SCOPE, FeedScope } from "./enums";

/**
 * FEED SERVICE
 * ---------------------------------------------------------------------------
 * A feed page, assembled from three independent decisions, in this order:
 *
 *   1. **Scope**   — which authors' posts are candidates. `PostVisibilityService`
 *                    owns the visibility rule; this module owns only the *author
 *                    set* that the scope implies.
 *   2. **Ranking** — the ordering, from the strategy registry. A strategy never
 *                    filters, so scope and ranking cannot be confused.
 *   3. **Paging**  — a keyset cursor that names the last row of the page.
 *
 * The service itself contains no ordering SQL and no visibility SQL. Both come
 * from their owning module, which is what makes "the feed shows exactly what the
 * profile shows" a structural property rather than a review-time agreement.
 *
 * ─── Why there is no fan-out-on-write here ──────────────────────────────────
 * The production design for a social feed is usually a fan-out table: writing a
 * post pushes its id into every follower's timeline, and reading a feed is a
 * keyset scan of that table. It is the right answer at a scale where a read
 * cannot be answered from the posts table, and this is emphatically not that
 * scale yet — there is no evidence a single indexed query is too slow, and
 * building the table before measuring means owning a second source of truth, a
 * repair path for a missed fan-out, and a write amplification cost paid on every
 * post forever.
 *
 * So the feed here is a *query* over `posts`, scoped by the follow graph. The
 * seam that matters is `FeedRankingStrategy`: when a read is genuinely too slow,
 * the migration is "materialise a timeline and change one strategy class", and
 * the client sees nothing. That is the upgrade path, and it is only available
 * because ranking and paging are already separated from scope.
 *
 * ─── Where Redis is used, and where it deliberately is not ──────────────────
 * Used: the follow set and the block set, via `SocialGraphService`'s cached
 * projections. Those are the two reads a feed cannot scope its query without,
 * they are the same for every request from the same viewer, and they change only
 * when that viewer changes their graph.
 *
 * Also used: a very short-lived cache of the **first page's ordered post ids**
 * per (viewer, scope, ranking). It exists to absorb one very specific pattern —
 * pull-to-refresh on a timer, or a client re-requesting page one on every
 * foreground — and it stores *ids only*. The rows are always re-read from
 * Postgres and re-filtered by the same visibility predicate, so a block, a
 * privacy change or a deletion takes effect immediately; the cache can only ever
 * be stale about *ordering*, never about *access*. The TTL is short enough
 * (2s) that even the ordering staleness is invisible.
 *
 * Not used: anything for a paged request (`cursor` present). Page two onward is
 * always a live query, because a keyset page is defined by a boundary the client
 * chose and caching it would mean serving a page whose contents depend on when
 * the client last asked.
 */
@Injectable()
export class FeedService {
  constructor(
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    private readonly visibility: PostVisibilityService,
    private readonly hydrator: PostHydrator,
    private readonly rankings: FeedRankingRegistry,
    private readonly cache: SocialCacheService
  ) {}

  /**
   * One page of a feed.
   *
   * The flow, and why each step is where it is:
   *   resolve strategy → resolve cursor (rejects one minted for another ordering)
   *   → build the scoped query → order → seek → over-fetch by one → hydrate.
   *
   * Nothing about the candidate set is decided after the rows arrive. A feed that
   * fetched a page and then filtered it would return short pages and would let
   * the cursor advance past posts the client never saw — the same two bugs
   * `PostsService.listByAuthor` documents, and the reason scope lives in SQL.
   */
  async getFeed(viewerId: string, query: FeedQueryDto): Promise<FeedPageResponseDto> {
    const scope = query.scope ?? DEFAULT_FEED_SCOPE;
    // Resolved first so a bad `strategy` is a 400 before any work is done, and so
    // the cursor below is validated against the right ordering.
    const ranking = this.rankings.resolve(query.strategy);
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, cursorStrategy(scope, ranking.id)) : null;

    const cachedIds = await this.cachedFirstPageIds(viewerId, scope, ranking.id, query);
    if (cachedIds) return this.hydrateByIds(cachedIds, viewerId, ranking, query.limit, scope, cursor);

    const rows = await this.fetchScoped(viewerId, scope, ranking, query, cursor);
    const page = toCursorPage(rows, query.limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: cursorStrategy(scope, ranking.id), k: ranking.cursorKeys(row) }));
    const visible = rows.slice(0, query.limit);

    // Only page one is worth remembering, and only as ids.
    if (!cursor) await this.rememberFirstPageIds(viewerId, scope, ranking.id, query, visible);

    return { ...envelope(page, scope, ranking.id), data: await this.hydrator.toResponses(visible, viewerId) };
  }

  /**
   * Builds the candidate query: visibility first, then scope, then ranking.
   *
   * The order of the `where` clauses is cosmetic; the order of the *concerns* is
   * not. The scope predicate is the only thing this module contributes to
   * filtering, and it is added after the visibility predicate so that a
   * FOLLOWERS-only post from a followed author and a PUBLIC post from anyone both
   * survive, exactly as they would in a profile read.
   */
  private async fetchScoped(viewerId: string, scope: FeedScope, ranking: FeedRankingStrategy, query: FeedQueryDto, cursor: { k: string[] } | null): Promise<Post[]> {
    const qb = this.postsRepo.createQueryBuilder("post").where("post.isDeleted = :isDeleted", { isDeleted: false });

    // Rule 1 of visibility: the scope predicate, which already encodes the
    // viewer's own posts, blocks, and the PUBLIC/FOLLOWERS tiers.
    const ctx: PostVisibilityContext = await this.visibility.contextFor(viewerId);
    this.visibility.applyScope(qb, ctx);

    // Rule 2 of visibility: the *author set* the scope asks for. This is the only
    // social knowledge the feed adds, and it is a narrowing of the candidate set
    // — never a widening, so it cannot be used to see anything the visibility
    // rule would have hidden. The *same* context is reused rather than resolved
    // again, so one feed read costs one graph resolution in total.
    this.applyScopeAuthors(qb, viewerId, scope, ctx);

    if (query.type) qb.andWhere("post.type = :type", { type: query.type });
    if (query.before) {
      // Bounded above by a caller-supplied instant. Passed as a parameter, never
      // interpolated, and validated as a date before it gets here.
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) qb.andWhere("post.createdAt < :before", { before });
    }

    if (cursor) ranking.seek(qb, cursor.k);
    ranking.applyOrdering(qb);
    return qb.take(query.limit + 1).getMany();
  }

  /**
   * Narrows the candidate set to the scope's authors.
   *
   * The two scopes that do *not* narrow (`discover`, `latest`) deliberately add
   * no author predicate at all: the visibility rule already admits every author
   * the viewer may see, and re-deriving a set from the follow graph would be a
   * second, differently-invalidated view of the same relationship.
   */
  private applyScopeAuthors(qb: SelectQueryBuilder<Post>, viewerId: string, scope: FeedScope, ctx: PostVisibilityContext): void {
    if (scope !== FeedScope.FOLLOWING) return;
    // The block filter is redundant with the visibility predicate and is kept
    // anyway, for a specific reason: it keeps a blocked author's ids out of the
    // SQL parameter list, so a blocked user cannot even be *counted* as a
    // candidate. Cheap defence in depth for the one query whose cost scales with
    // the size of the follow graph.
    const followed = ctx.followingIds.filter((id) => !ctx.blockedIds.includes(id));
    // The viewer's own posts are always in their own feed. A user who follows
    // nobody still sees what they wrote, which is both what "my feed" means and
    // what stops a brand-new account from opening on an empty screen.
    const authors = [...followed, viewerId];
    qb.andWhere("post.authorId IN (:...feedAuthors)", { feedAuthors: authors });
  }

  // ─── First-page id cache ───────────────────────────────────────────────────

  /**
   * Returns the cached first-page ids, or `null` to run the real query.
   *
   * Re-scoping happens even on a hit: the cached list is only ever a candidate
   * ordering, and the `WHERE post.id IN (…) AND <visibility>` query below is what
   * guarantees a cached page can never contain a post the viewer is no longer
   * allowed to see. A hit that fails the re-scope simply returns a shorter page,
   * which is correct behaviour and is invisible in practice (it requires a block
   * or a privacy change inside a 2-second window).
   */
  private async cachedFirstPageIds(viewerId: string, scope: FeedScope, strategyId: string, query: FeedQueryDto): Promise<string[] | null> {
    if (query.cursor || query.type || query.before) return null;
    return this.cache.get<string[]>(firstPageKey(viewerId, scope, strategyId, query.limit));
  }

  private async rememberFirstPageIds(viewerId: string, scope: FeedScope, strategyId: string, query: FeedQueryDto, rows: Post[]): Promise<void> {
    if (query.type || query.before) return;
    await this.cache.set(
      firstPageKey(viewerId, scope, strategyId, query.limit),
      rows.map((row) => row.id),
      FEED_FIRST_PAGE_TTL_SECONDS
    );
  }

  /**
   * Re-reads a cached page's rows by id, re-applying visibility and the ranking's
   * order.
   *
   * Two things are re-established rather than trusted from the cache:
   *   - **access**, via the same visibility predicate, so the cache cannot serve
   *     something the viewer has since lost the right to see;
   *   - **order**, via `applyOrdering` on the re-read rows, so the cache is only
   *     a *set* of candidates and the current ranking is always what decides the
   *     sequence. That is what keeps a ranking change from being shadowed by a
   *     stale cached list.
   */
  private async hydrateByIds(
    ids: string[],
    viewerId: string,
    ranking: FeedRankingStrategy,
    limit: number,
    scope: FeedScope,
    cursor: { k: string[] } | null
  ): Promise<FeedPageResponseDto> {
    const qb = this.postsRepo.createQueryBuilder("post").where("post.id IN (:...cachedIds)", { cachedIds: ids });
    const ctx: PostVisibilityContext = await this.visibility.contextFor(viewerId);
    this.visibility.applyScope(qb, ctx);
    if (cursor) ranking.seek(qb, cursor.k);
    ranking.applyOrdering(qb);

    const rows = await qb.take(limit + 1).getMany();
    const page = toCursorPage(rows, limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: cursorStrategy(scope, ranking.id), k: ranking.cursorKeys(row) }));
    return { ...envelope(page, scope, ranking.id), data: await this.hydrator.toResponses(rows.slice(0, limit), viewerId) };
  }
}

/**
 * The cursor strategy name binds *scope* to *ranking*.
 *
 * `latest` and `discover` describe the same candidate set, and a cursor from one
 * must not be replayed against the other: the ranking a client was paging under
 * is the thing that determines what "after the last row" means, and a
 * `(scope, strategy)` pair is the smallest name that captures it. A client that
 * switches either gets a 400 telling it to restart, which is the recoverable
 * outcome.
 */
function cursorStrategy(scope: FeedScope, strategyId: string): string {
  return `feed:${scope}:${strategyId}`;
}

function envelope(page: { nextCursor: string | null; hasMore: boolean }, scope: FeedScope, strategy: string): FeedPageResponseDto {
  return { data: [], meta: { nextCursor: page.nextCursor, hasMore: page.hasMore }, scope, strategy };
}

function firstPageKey(viewerId: string, scope: FeedScope, strategyId: string, limit: number): string {
  return SOCIAL_REDIS_KEYS.feedFirstPage(viewerId, scope, strategyId, limit);
}

/** Short enough that even an ordering change is invisible to a reader. */
const FEED_FIRST_PAGE_TTL_SECONDS = SOCIAL_CACHE_TTL.feedFirstPageSeconds;
