import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CursorPageMetaDto } from "src/common/dto";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, toCursorPage } from "src/common/social";
import { SocialRateLimiter, SocialUserLoader } from "src/shared/social";
import { User } from "src/modules/users/entities/user.entity";
import { BlockedUserResponseDto, BlockListQueryDto, BlockListResponseDto, CreateBlockDto } from "./dto";
import { Follow, UserBlock } from "./entities";
import { SocialGraphService } from "./social-graph.service";

/** Cursor strategy for the block list; same ordering contract as the follow lists. */
const BLOCK_LIST_CURSOR_STRATEGY = "block_created_desc";

/**
 * BLOCKS SERVICE
 * ---------------------------------------------------------------------------
 * Blocking is the foundation the rest of the abuse model is built on, so it is
 * worth being precise about what a block does and does not do.
 *
 * ─── What it does ───────────────────────────────────────────────────────────
 *   - Hides each user's content from the other, in **both** directions. The row
 *     is directional (`blocker → blocked`) because that keeps one unique index
 *     and a one-row write, but every read treats it as mutual: a one-way block
 *     is bypassed by signing in on a second device, so symmetry has to live in
 *     the read path (`SocialGraphService.blockedUserIds` unions both directions).
 *   - Soft-deletes the follow edges in **both** directions, in the same
 *     transaction. This is not housekeeping — a surviving edge would keep the
 *     pair inside each other's cached follow graph and keep follower counts
 *     inflated, and a block that leaves a live edge behind is a block a
 *     determined user walks straight through by re-following.
 *   - Prevents a new follow while live, checked on the write *and* on the read.
 *
 * ─── What it deliberately does not do ────────────────────────────────────────
 * It is not a moderation system, and it does not delete anything. The blocked
 * user's posts, comments and likes remain in the database and remain reachable
 * to moderators and to reporting. That is why `UserBlock.reason` is documented as
 * the blocker's own bookkeeping: nothing — no feed query, no enforcement branch,
 * no ranking signal — may depend on a value the blocker chose.
 *
 * ─── Why the destructive part is transactional ──────────────────────────────
 * "Block created but follows still live" is the one state this module must never
 * be observable in, because the follow-graph cache may already hold the old set.
 * Writing the block and tearing down both edges in one transaction makes the
 * intermediate state unreachable, and the cache is invalidated only after the
 * commit.
 */
@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(UserBlock) private readonly blocksRepo: Repository<UserBlock>,
    @InjectRepository(Follow) private readonly followsRepo: Repository<Follow>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly graph: SocialGraphService,
    private readonly userLoader: SocialUserLoader,
    private readonly rateLimiter: SocialRateLimiter,
    private readonly dataSource: DataSource
  ) {}

  /**
   * Block a user. 409 on a second attempt — the same reasoning as `follow`:
   * "already blocked" is a different fact from "just blocked", and a client that
   * cannot tell them apart will double-render.
   */
  async block(blockerId: string, blockedId: string, dto: CreateBlockDto): Promise<BlockedUserResponseDto> {
    if (blockerId === blockedId) throw new BadRequestException("You cannot block yourself");

    this.rateLimiter.assertAllowed("block", await this.rateLimiter.consume("block", blockerId));

    const blocked = await this.requireLiveUser(blockedId);
    if (await this.blocksRepo.findOne({ where: { blockerId, blockedId, isDeleted: false }, select: { id: true } })) {
      throw new ConflictException("You already blocked this user");
    }

    let created: UserBlock;
    try {
      created = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(UserBlock);
        const block = await repo.save(repo.create({ blockerId, blockedId, reason: dto.reason ?? null, isDeleted: false }));
        await this.severFollowEdges(manager, blockerId, blockedId);
        return block;
      });
    } catch (error) {
      // `uk_social_blocks_pair` (partial) is the authority; the loser of a
      // concurrent double-block gets a 409, not a 500.
      if (isUniqueViolation(error)) throw new ConflictException("You already blocked this user");
      throw error;
    }

    await this.graph.invalidate(blockerId, blockedId);
    const summary = await this.userLoader.loadByIds([blockedId]);
    return { ...(summary.get(blockedId) ?? { id: blockedId, name: blocked.name, avatarUrl: null }), blockedAt: created.createdAt, reason: created.reason, note: created.note };
  }

  /**
   * Unblock. Idempotent, and it does **not** restore the follow edges.
   *
   * Restoring them would let one person re-follow unilaterally and would make
   * "unblock" a way to re-establish a relationship the other party never agreed
   * to. The two users are back to strangers, which is the honest state.
   */
  async unblock(blockerId: string, blockedId: string): Promise<{ unblocked: true }> {
    if (blockerId === blockedId) throw new BadRequestException("You cannot unblock yourself");

    const existing = await this.blocksRepo.findOne({ where: { blockerId, blockedId, isDeleted: false }, select: { id: true } });
    if (!existing) return { unblocked: true };

    await this.blocksRepo.update({ id: existing.id }, { isDeleted: true, deletedAt: new Date(), deletedBy: blockerId });
    await this.graph.invalidate(blockerId, blockedId);
    return { unblocked: true };
  }

  /** Who the caller has blocked, newest first. Keyset-paginated. */
  async listBlocked(blockerId: string, query: BlockListQueryDto): Promise<BlockListResponseDto> {
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, BLOCK_LIST_CURSOR_STRATEGY) : null;
    const qb = this.blocksRepo
      .createQueryBuilder("block")
      .where("block.blockerId = :blockerId", { blockerId })
      .andWhere("block.isDeleted = false")
      .orderBy("block.createdAt", "DESC")
      .addOrderBy("block.id", "DESC")
      .take(query.limit + 1);
    if (cursor) {
      if (cursor.k.length !== 2) throw new BadRequestException("Malformed cursor");
      qb.andWhere("(block.createdAt, block.id) < (:cursorCreatedAt, :cursorId)", { cursorCreatedAt: new Date(cursor.k[0]), cursorId: cursor.k[1] });
    }

    const rows = await qb.getMany();
    const users = await this.userLoader.loadByIds(rows.map((row) => row.blockedId));
    const page = toCursorPage(rows, query.limit, (row) =>
      encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: BLOCK_LIST_CURSOR_STRATEGY, k: [row.createdAt.toISOString(), row.id] })
    );
    const data: BlockedUserResponseDto[] = rows.slice(0, query.limit).flatMap((row) => {
      const user = users.get(row.blockedId);
      return user ? [{ ...user, blockedAt: row.createdAt, reason: row.reason, note: row.note }] : [];
    });
    const meta: CursorPageMetaDto = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    return { data, meta };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Soft-deletes every live follow edge between the two users, in both
   * directions, on the caller's transaction.
   *
   * Bounded to a single UPDATE on the pair rather than a read-modify-write: the
   * partial unique index guarantees at most one live edge per direction, so the
   * set of rows to tear down is known to be tiny and the whole thing is a single
   * statement that cannot interleave with a concurrent follow.
   */
  private async severFollowEdges(manager: EntityManager, blockerId: string, blockedId: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Follow)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: blockerId })
      .where("isDeleted = false")
      .andWhere("((follower_id = :blockerId AND following_id = :blockedId) OR (follower_id = :blockedId AND following_id = :blockerId))", { blockerId, blockedId })
      .execute();
  }

  private async requireLiveUser(userId: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id: userId, isDeleted: false } });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
