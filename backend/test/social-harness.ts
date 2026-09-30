/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { App } from "supertest/types";
import { DataSource, EntityManager, FindOperator, In, IsNull, Repository } from "typeorm";

import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";

import { PostComment } from "src/modules/comments/entities";
import { CommentsController } from "src/modules/comments/comments.controller";
import { CommentsService } from "src/modules/comments/comments.service";

import { Post } from "src/modules/posts/entities";
import { PostEngagementService } from "src/modules/posts/post-engagement.service";
import { PostHydrator } from "src/modules/posts/post-hydrator.service";
import { PostVisibilityService } from "src/modules/posts/post-visibility.service";
import { PostsController } from "src/modules/posts/posts.controller";
import { PostsService } from "src/modules/posts/posts.service";

import { FeedController } from "src/modules/feed/feed.controller";
import { FeedService } from "src/modules/feed/feed.service";
import { FeedRankingRegistry } from "src/modules/feed/feed-ranking";

import { Follow, UserBlock } from "src/modules/follows/entities";
import { BlocksController } from "src/modules/follows/blocks.controller";
import { BlocksService } from "src/modules/follows/blocks.service";
import { FollowsController } from "src/modules/follows/follows.controller";
import { FollowsService } from "src/modules/follows/follows.service";
import { SocialGraphService } from "src/modules/follows/social-graph.service";

import { PostLike } from "src/modules/likes/entities";
import { LikesController } from "src/modules/likes/likes.controller";
import { LikesService } from "src/modules/likes/likes.service";

import { ContentReport } from "src/modules/reports/entities";
import { ReportsController } from "src/modules/reports/reports.controller";
import { ReportsService } from "src/modules/reports/reports.service";
import { ReportStatus } from "src/modules/reports/enums";

import { DomainEventPublisher } from "src/common/events";
import { SocialCacheService, SocialRateLimiter, SocialUserLoader, SocialUserPresenter } from "src/shared/social";
import { RedisConnectionFactory } from "src/shared/redis/redis-connection.factory";

import { FakeQueryBuilder, FakeUpdateQueryBuilder, Row } from "./query-fake";

/**
 * SOCIAL PLATFORM TEST HARNESS
 * ---------------------------------------------------------------------------
 * An in-memory stand-in for Postgres + Redis that runs the *real* services.
 *
 * ─── Why a fake database and not a container ─────────────────────────────────
 * Two reasons, and the second is the point. First, the repo's established e2e
 * pattern (`coach-client-programs.e2e-spec.ts`) wires explicit controllers and
 * providers rather than importing the real modules, because importing
 * `FollowsModule` drags in `NotificationsModule` → `AuthModule` → Redis and
 * BullMQ workers, and a social test would then be a test of the whole app
 * bootstrap. Second — and this is what makes the fake *worth* its cost — the
 * parts most worth asserting are the parts a container would execute but not
 * explain:
 *
 *   - **The partial unique indexes.** `uk_post_likes_pair`,
 *     `uk_social_follows_pair`, `uk_reports_*_dedupe` and the rest are all
 *     `WHERE "isDeleted" = false`. Every duplicate-prevention claim in the social
 *     platform is ultimately an index, not a read-then-write check, and a fake
 *     that skipped them would let a regression in *that* pass. Here a violation
 *     throws `{ code: "23505" }`, which is exactly what the services translate
 *     into a 409.
 *   - **The affected-row gates.** `LikesService.unlike` and
 *     `CommentsService.remove` only move a counter when the soft delete actually
 *     matched a live row. `FakeUpdateQueryBuilder` really filters rows and
 *     reports `affected`, so a double-decrement regression fails here.
 *   - **The graph cache.** `SocialCacheService` and `SocialRateLimiter` run for
 *     real against a Map-backed Redis client, so "the block must take effect
 *     immediately even though the previous projection was cached" is a real
 *     assertion rather than a mock's `expect`.
 *   - **Transactions.** `DataSource.transaction` snapshots every table and rolls
 *     back on throw, so "the counter and the fact commit together" is testable:
 *     a failure inside the transaction leaves no half-written like behind.
 *
 * What is *not* faked: the services, controllers, DTO validation, the visibility
 * rule, the SQL evaluator in `query-fake.ts`, and the cursor codec.
 *
 * ─── The one thing that is stubbed ───────────────────────────────────────────
 * `DomainEventPublisher`. Its real implementation writes to the notification
 * outbox, which needs the notification module; the *abstraction* is what the
 * social services depend on, so recording the published events is the faithful
 * substitute — and it lets a test assert that a follow announces a follower and
 * that a comment does **not** announce one to its own author.
 */

/* ─────────────────────────── tables & column maps ─────────────────────────── */

interface SocialTables {
  users: Row[];
  coaches: Row[];
  workouts: Row[];
  workoutTemplates: Row[];
  posts: Row[];
  follows: Row[];
  blocks: Row[];
  likes: Row[];
  comments: Row[];
  reports: Row[];
}

let tables: SocialTables;
let seq = 0;

/** Deterministic, monotonically increasing uuids that still sort like strings. */
export const newId = (): string => `90000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

/**
 * `column_name -> property_name` per table.
 *
 * Needed because the services mix the two spellings freely: a select builder
 * speaks `post.likeCount` while the same module's update builder speaks
 * `like_count` inside a raw `GREATEST(0, …)`. The fake has to resolve both or a
 * legitimate predicate reads `undefined` and matches nothing.
 */
const COLUMN_MAPS: Record<keyof SocialTables, Record<string, string>> = {
  users: {},
  coaches: {},
  workouts: {},
  workoutTemplates: {},
  posts: { author_id: "authorId", like_count: "likeCount", comment_count: "commentCount", created_at: "createdAt", workout_id: "workoutId", is_deleted: "isDeleted" },
  follows: { follower_id: "followerId", following_id: "followingId", created_at: "createdAt" },
  blocks: { blocker_id: "blockerId", blocked_id: "blockedId", created_at: "createdAt" },
  likes: { post_id: "postId", user_id: "userId", created_at: "createdAt" },
  comments: { post_id: "postId", author_id: "authorId", parent_id: "parentId", reply_count: "replyCount", created_at: "createdAt" },
  reports: {
    reporter_id: "reporterId",
    target_type: "targetType",
    user_id: "userId",
    post_id: "postId",
    comment_id: "commentId",
    target_author_id: "targetAuthorId",
    created_at: "createdAt"
  }
};

/** The entities whose repositories the social services inject. */
const ENTITIES = { User, Coach, Workout, WorkoutTemplate, Post, Follow, UserBlock, PostLike, PostComment, ContentReport };

type EntityName = keyof typeof ENTITIES;

const TABLE_FOR: Record<EntityName, keyof SocialTables> = {
  User: "users",
  Coach: "coaches",
  Workout: "workouts",
  WorkoutTemplate: "workoutTemplates",
  Post: "posts",
  Follow: "follows",
  UserBlock: "blocks",
  PostLike: "likes",
  PostComment: "comments",
  ContentReport: "reports"
};

/**
 * Partial unique indexes, enforced in memory.
 *
 * This is the single most important thing in this file. Every duplicate-
 * prevention guarantee in the social platform is a partial unique index rather
 * than a service-level read-then-write, precisely because the read-then-write is
 * racy. A harness that did not model them would let every one of those claims
 * regress into "usually true".
 *
 * `WHERE isDeleted = false` on all of them is the reason unfollow/unlike/
 * unblock never permanently block the second attempt.
 */
type UniqueIndex = {
  name: string;
  columns: string[];
  /** Extra predicate on top of `isDeleted = false`. */
  when?: (row: Row) => boolean;
};

const UNIQUE_INDEXES: Record<keyof SocialTables, UniqueIndex[]> = {
  users: [],
  coaches: [],
  workouts: [],
  workoutTemplates: [],
  posts: [{ name: "uk_posts_author_workout", columns: ["authorId", "workoutId"], when: (row) => row.workoutId != null }],
  follows: [{ name: "uk_social_follows_pair", columns: ["followerId", "followingId"] }],
  blocks: [{ name: "uk_social_blocks_pair", columns: ["blockerId", "blockedId"] }],
  likes: [{ name: "uk_post_likes_pair", columns: ["postId", "userId"] }],
  comments: [{ name: "uk_post_comments_live_body", columns: ["authorId", "postId", "body"] }],
  reports: [
    { name: "uk_reports_user_dedupe", columns: ["reporterId", "userId"], when: (row) => row.targetType === "user" },
    { name: "uk_reports_post_dedupe", columns: ["reporterId", "postId"], when: (row) => row.targetType === "post" },
    { name: "uk_reports_comment_dedupe", columns: ["reporterId", "commentId"], when: (row) => row.targetType === "comment" }
  ]
};

/**
 * Postgres 23505, as the services see it.
 *
 * They only ever read `.code`, so that is all the fake has to produce — but it is
 * produced as an `Error` rather than a bare object so a failing test's stack
 * trace still names the index that refused the row.
 */
const uniqueViolation = (index: string, columns: string[]): Error =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${index}" (${columns.join(", ")})`), { code: "23505" });

/**
 * Enforces the partial unique indexes for one table.
 *
 * The report dedupe is three per-type partials (`uk_reports_*_dedupe`), mirroring
 * the migration: each fires only for its `target_type`, so a POST report (whose
 * `user_id` and `comment_id` are NULL) collides only with another POST report
 * for the same reporter and post. A single bare-column index would never fire,
 * because Postgres treats NULL as distinct — modelling it as "NULL matches NULL"
 * would be the unfaithful reading.
 */
const enforceUniqueIndexes = (table: keyof SocialTables, candidate: Row): void => {
  if (candidate.isDeleted === true) return;
  for (const index of UNIQUE_INDEXES[table]) {
    if (index.when && !index.when(candidate)) continue;
    const clash = tables[table].some(
      (row) =>
        row.id !== candidate.id &&
        row.isDeleted !== true &&
        (index.when === undefined || index.when(row)) &&
        index.columns.every((column) => normalizeUniqueValue(row[column]) === normalizeUniqueValue(candidate[column]))
    );
    if (clash) throw uniqueViolation(index.name, index.columns);
  }
};

/** `undefined` (absent key) and `null` (NULL column) compare equal, as in SQL. */
const normalizeUniqueValue = (value: unknown): unknown => (value === undefined ? null : value);

/* ───────────────────────────── find-operator support ──────────────────────── */

/**
 * `FindOptionsWhere` value matching.
 *
 * `In(...)` is the only one the social read paths use, plus `IsNull()` in
 * `ReportsService.findExisting` — and the `IsNull()` is load-bearing, because
 * TypeORM *ignores* a bare `null` in a where object rather than turning it into
 * `IS NULL`. A harness that treated `null` as "skip this key" would faithfully
 * reproduce that bug and quietly pass the very test that documents it, so this
 * matches `null` as SQL does.
 *
 * Operators are detected by their private `instanceof` brand rather than by
 * shape, exactly the way TypeORM does, so `In(["a"])` cannot be confused with a
 * plain array.
 */
const FIND_OPERATOR = Symbol.for("FindOperator");

const isFindOperator = (value: unknown): value is FindOperator<unknown> => {
  if (typeof value !== "object" || value === null) return false;
  // TypeORM v0.3 brands operators via a private '@instanceof' symbol and
  // exposes `type`/`value` getters; older docs referenced Symbol.for.
  if (value instanceof FindOperator) return true;
  const branded = (value as Record<string | symbol, unknown>)["@instanceof"];
  if (typeof branded === "symbol" && branded.description === "FindOperator") return true;
  if (typeof (value as { type?: unknown }).type === "string" && "value" in (value as object)) {
    const t = (value as { type: string }).type;
    if (t === "in" || t === "isNull" || t === "not" || t === "lessThan" || t === "moreThan" || t === "equal") return true;
  }
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[FIND_OPERATOR] === true;
};

const matchesWhere = (row: Row, where: Record<string, unknown> | Record<string, unknown>[] | undefined): boolean => {
  if (!where) return true;
  // TypeORM allows `where: [{...}, {...}]` as OR. Support it so a future
  // service using OR does not silently match nothing.
  if (Array.isArray(where)) return where.some((clause) => matchesWhere(row, clause));
  return Object.entries(where).every(([key, expected]) => {
    // TypeORM ignores `undefined`, never `null`.
    if (expected === undefined) return true;
    if (isFindOperator(expected)) return matchFindOperator(row[key], expected);
    if (expected === null) return row[key] == null;
    return row[key] === expected;
  });
};

const matchFindOperator = (actual: unknown, operator: FindOperator<unknown>): boolean => {
  switch (operator.type) {
    case "in":
      return (operator.value as unknown[]).map(String).includes(String(actual));
    case "isNull":
      return actual == null;
    case "not":
      return !matchFindOperator(actual, operator.value as FindOperator<unknown>);
    default:
      throw new Error(`social-harness: unsupported find operator "${operator.type}"`);
  }
};

/**
 * Applies the projection from a `find({ select })` call.
 *
 * TypeORM returns *narrowed* rows for a `select` projection — which is why
 * `SocialGraphService` can `rows.map((row) => row.followingId)` after asking for
 * `{ select: { followingId: true } }`. A fake that ignored `select` would return
 * the whole row and make the same code work for the wrong reason, so the
 * projection is honoured.
 */
const projectRow = (row: Row, select: Record<string, boolean> | undefined): Row => {
  if (!select) return row;
  const out: Row = { id: row.id };
  for (const [key, wanted] of Object.entries(select)) if (wanted) out[key] = row[key];
  return out;
};

const byOrder =
  (order: Record<string, "ASC" | "DESC"> | undefined) =>
  (a: Row, b: Row): number => {
    if (!order) return 0;
    for (const [key, dir] of Object.entries(order)) {
      if (a[key] === b[key]) continue;
      const cmp = a[key] instanceof Date ? a[key].getTime() - (b[key] as Date).getTime() : String(a[key]) < String(b[key]) ? -1 : 1;
      return dir === "DESC" ? -cmp : cmp;
    }
    return 0;
  };

/* ──────────────────────────────── relations ──────────────────────────────── */

/**
 * Re-attaches the relation properties TypeORM hydrates eagerly.
 *
 * `ReportsService.resolveTarget` calls `assertViewable(comment.post, …)`, so a
 * comment row without its `post` attached would make that check throw on a
 * missing author rather than evaluating the visibility rule — the test would
 * pass for the wrong reason. Same reasoning for `comment.author`, which the
 * notification payload reads for `authorName`.
 */
const attachRelations = (row: Row): void => {
  if ("postId" in row) row.post = tables.posts.find((post) => post.id === row.postId) ?? null;
  if ("authorId" in row) row.author = tables.users.find((user) => user.id === row.authorId) ?? null;
  if ("userId" in row && row.post) row.user = tables.users.find((user) => user.id === row.userId) ?? null;
  if ("followerId" in row) {
    row.follower = tables.users.find((user) => user.id === row.followerId) ?? null;
    row.following = tables.users.find((user) => user.id === row.followingId) ?? null;
  }
  if ("blockerId" in row) {
    row.blocker = tables.users.find((user) => user.id === row.blockerId) ?? null;
    row.blocked = tables.users.find((user) => user.id === row.blockedId) ?? null;
  }
  if ("targetType" in row) {
    if (row.userId) row.user = tables.users.find((user) => user.id === row.userId) ?? null;
    if (row.postId) row.post = tables.posts.find((post) => post.id === row.postId) ?? null;
    if (row.commentId) row.comment = tables.comments.find((comment) => comment.id === row.commentId) ?? null;
  }
};

/* ──────────────────────────────── fake repos ─────────────────────────────── */

interface RepoOptions {
  table: () => Row[];
  entityName: EntityName;
  /** Property defaults applied on insert, standing in for column defaults. */
  defaults?: () => Row;
}

const makeRepo = ({ table, entityName, defaults }: RepoOptions): Repository<Row> =>
  ({
    create: jest.fn((row: Row) => row),
    save: jest.fn((row: Row) => {
      const rows = table();
      row.isDeleted ??= false;
      row.deletedAt ??= null;
      row.deletedBy ??= null;
      row.updatedAt = new Date(Date.now());

      const existing = row.id ? rows.find((candidate) => candidate.id === row.id) : undefined;
      if (existing) {
        // A partial update: TypeORM's `save({ id, …patch })` merges rather than
        // replacing, so a field absent from the patch keeps its stored value.
        // Assigning the whole row instead would blank `likeCount` on every
        // `postsRepo.save({ id, body })`, which would make counters look
        // plausible and be wrong.
        //
        // The index check therefore runs against the *merged* projection: the
        // stored row is exempt from its own constraint by reference, so
        // checking `existing` would check nothing at all. Every soft-un-delete
        // path (`unfollow`, `unlike`, comment restore) goes through here, and
        // "re-following after an unfollow must not trip the pair index" is
        // exactly the claim that needs the merged view to be tested.
        enforceUniqueIndexes(TABLE_FOR[entityName], { ...existing, ...row });
        Object.assign(existing, row);
        attachRelations(existing);
        return Promise.resolve(existing);
      }

      Object.assign(row, { ...(defaults?.() ?? {}), ...row });
      row.id = newId();
      row.createdAt = new Date(Date.now());
      row.updatedAt = row.createdAt;
      enforceUniqueIndexes(TABLE_FOR[entityName], row);
      rows.push(row);
      attachRelations(row);
      return Promise.resolve(row);
    }),
    update: jest.fn((where: Row, patch: Row) => {
      const rows = table().filter((row) => matchesWhere(row, where));
      for (const row of rows) Object.assign(row, patch);
      return Promise.resolve({ affected: rows.length, raw: rows, generatedMaps: [] });
    }),
    find: jest.fn((options: { where?: Row; order?: Row; select?: Record<string, boolean> } = {}) => {
      const rows = table()
        .filter((row) => matchesWhere(row, options.where))
        .sort(byOrder(options.order));
      return Promise.resolve(rows.map((row) => projectRow(row, options.select)));
    }),
    findOne: jest.fn((options: { where?: Row; select?: Record<string, boolean> } = {}) => {
      const row = table().find((candidate) => matchesWhere(candidate, options.where));
      return Promise.resolve(row ? projectRow(row, options.select) : null);
    }),
    count: jest.fn((options: { where?: Row } = {}) => Promise.resolve(table().filter((row) => matchesWhere(row, options.where)).length)),
    createQueryBuilder: jest.fn(() => new FakeQueryBuilder(table(), joinResolver, false, fakeQueryOptions(entityName)))
  }) as unknown as Repository<Row>;

/**
 * JOIN resolver.
 *
 * Only the feed and the post list join, and only onto a table the fake already
 * holds. Returning `null` for an unknown alias makes the builder drop the row
 * (INNER JOIN semantics) — the loud behaviour we want, since an unmodelled join
 * should fail rather than silently return everything.
 */
const joinResolver = (alias: string, row: Row): Row | null => {
  if (alias === "author") return tables.users.find((user) => user.id === row.authorId) ?? null;
  if (alias === "user") return tables.users.find((user) => user.id === (row.userId ?? row.authorId)) ?? null;
  if (alias === "post") return tables.posts.find((post) => post.id === row.postId) ?? null;
  return {};
};

const fakeQueryOptions = (entityName: EntityName) => ({
  columns: COLUMN_MAPS[TABLE_FOR[entityName]],
  now: () => new Date(Date.now())
});

/* ─────────────────────────── fake EntityManager ──────────────────────────── */

/**
 * `EntityManager` and `DataSource` stand-ins with a real transaction boundary.
 *
 * `transaction` snapshots every table and restores it on a throw. That is what
 * makes the "counter and fact commit together" claim testable: a service that
 * inserted the like and *then* failed to move the counter would, under a
 * non-transactional fake, leave a like with no matching count — a state the
 * production code cannot produce and a regression that this test would not
 * otherwise catch.
 */
const snapshot = (): SocialTables => ({
  users: tables.users.map((row) => ({ ...row })),
  coaches: tables.coaches.map((row) => ({ ...row })),
  workouts: tables.workouts.map((row) => ({ ...row })),
  workoutTemplates: tables.workoutTemplates.map((row) => ({ ...row })),
  posts: tables.posts.map((row) => ({ ...row })),
  follows: tables.follows.map((row) => ({ ...row })),
  blocks: tables.blocks.map((row) => ({ ...row })),
  likes: tables.likes.map((row) => ({ ...row })),
  comments: tables.comments.map((row) => ({ ...row })),
  reports: tables.reports.map((row) => ({ ...row }))
});

const restore = (state: SocialTables): void => {
  tables = state;
  for (const row of Object.values(tables).flat()) attachRelations(row);
};

const entityNameOf = (entity: unknown): EntityName => {
  const match = (Object.keys(ENTITIES) as EntityName[]).find((name) => ENTITIES[name] === entity);
  if (!match) throw new Error(`social-harness: no table registered for entity ${(entity as { name?: string })?.name ?? String(entity)}`);
  return match;
};

/* ──────────────────────────────── repository lookup ──────────────────────── */

const repos = new Map<EntityName, Repository<Row>>();

const repoFor = (entity: unknown): Repository<Row> => {
  const repo = repos.get(entityNameOf(entity));
  if (!repo) throw new Error(`social-harness: no repository registered for ${entityNameOf(entity)}`);
  return repo;
};

const makeManager = (): EntityManager =>
  ({
    getRepository: (entity: unknown) => repoFor(entity) as never,
    createQueryBuilder: () => ({
      update: (entity: unknown) => {
        const name = entityNameOf(entity);
        return new FakeUpdateQueryBuilder(tables[TABLE_FOR[name]], { columns: COLUMN_MAPS[TABLE_FOR[name]] });
      }
    })
  }) as unknown as EntityManager;

const dataSource = {
  transaction: async <T>(run: (manager: EntityManager) => Promise<T>): Promise<T> => {
    const before = snapshot();
    try {
      return await run(makeManager());
    } catch (error) {
      restore(before);
      throw error;
    }
  },
  getRepository: (entity: unknown) => repoFor(entity) as never,
  manager: makeManager()
};

/* ──────────────────────────────── fake Redis ─────────────────────────────── */

/**
 * A Map-backed Redis client with TTL bookkeeping.
 *
 * Real Redis, not a stub: `SocialRateLimiter` depends on `INCR` returning the
 * *post-increment* value and on `TTL` reporting `-1` for a key that has lost its
 * expiry, and `SocialCacheService` depends on `JSON.parse(JSON.stringify(...))`
 * round-tripping. Both behaviours are load-bearing (the first decides when the
 * 429 fires, the second decides whether a cached projection is usable), so a
 * client that returned canned values would test the wrong thing.
 *
 * Expiry is evaluated against `Date.now()`, which means a test that pins the
 * clock also pins the cache window — deliberately, so the feed's first-page cache
 * tests are not a race.
 */
interface FakeRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<"OK">;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  /** Test-only: drops every key. */
  flush(): void;
}

const redisStore = new Map<string, { value: string; expiresAt: number | null }>();

const readRedis = (key: string): { value: string; expiresAt: number | null } | null => {
  const entry = redisStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    redisStore.delete(key);
    return null;
  }
  return entry;
};

const fakeRedis: FakeRedisClient = {
  get: (key) => Promise.resolve(readRedis(key)?.value ?? null),
  set: (key, value, mode, ttl) => {
    redisStore.set(key, { value, expiresAt: mode === "EX" && typeof ttl === "number" ? Date.now() + ttl * 1000 : null });
    return Promise.resolve("OK" as const);
  },
  del: (...keys) => {
    let removed = 0;
    for (const key of keys) if (redisStore.delete(key)) removed++;
    return Promise.resolve(removed);
  },
  incr: (key) => {
    const current = Number(readRedis(key)?.value ?? "0") + 1;
    const existing = readRedis(key);
    redisStore.set(key, { value: String(current), expiresAt: existing?.expiresAt ?? null });
    return Promise.resolve(current);
  },
  ttl: (key) => {
    const entry = readRedis(key);
    if (!entry) return Promise.resolve(-2);
    if (entry.expiresAt === null) return Promise.resolve(-1);
    return Promise.resolve(Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)));
  },
  expire: (key, seconds) => {
    const entry = readRedis(key);
    if (!entry) return Promise.resolve(0);
    redisStore.set(key, { value: entry.value, expiresAt: Date.now() + seconds * 1000 });
    return Promise.resolve(1);
  },
  flush: () => redisStore.clear()
};

/* ──────────────────────────── published events ──────────────────────────── */

export interface RecordedEvent {
  type: string;
  idempotencyKey: string;
  actorId: string;
  audience: { kind: string; userIds: string[]; excludeActor?: boolean };
  aggregate: { type: string; id: string };
  payload: Record<string, unknown>;
}

const published: RecordedEvent[] = [];

const domainEventPublisherStub = {
  publish: jest.fn((event: RecordedEvent) => {
    published.push(event);
    return Promise.resolve();
  }),
  publishInTransaction: jest.fn((_manager: EntityManager, event: RecordedEvent) => {
    published.push(event);
    return Promise.resolve();
  })
};

/* ────────────────────────────── repo construction ────────────────────────── */

/**
 * Column defaults, applied on insert.
 *
 * Only where a missing default would be visible in a response. `status` on a
 * report is the important one: `ReportResponseDto.status` is read straight off
 * the row, and TypeORM fills it from the column default, so a harness that
 * omitted it would render `undefined` and every triage assertion would be about
 * a field the real database always populates.
 */
const DEFAULTS: Record<EntityName, () => Row> = {
  User: () => ({ isDeleted: false, googlePhotoUrl: null, avatar: null }),
  Coach: () => ({ isDeleted: false }),
  Workout: () => ({ isDeleted: false }),
  WorkoutTemplate: () => ({ isDeleted: false }),
  Post: () => ({ isDeleted: false, likeCount: 0, commentCount: 0, type: "text", privacy: "public", body: null, workoutId: null, workoutTemplateId: null }),
  Follow: () => ({ isDeleted: false }),
  UserBlock: () => ({ isDeleted: false, reason: null, note: null }),
  PostLike: () => ({ isDeleted: false }),
  PostComment: () => ({ isDeleted: false, depth: 0, parentId: null, replyCount: 0 }),
  ContentReport: () => ({
    isDeleted: false,
    status: ReportStatus.REPORTED,
    details: null,
    userId: null,
    postId: null,
    commentId: null,
    targetAuthorId: null,
    targetExcerpt: null,
    resolvedAt: null,
    resolutionNote: null
  })
};

const buildRepos = (): void => {
  repos.clear();
  for (const name of Object.keys(ENTITIES) as EntityName[]) {
    const tableName = TABLE_FOR[name];
    repos.set(name, makeRepo({ table: () => tables[tableName], entityName: name, defaults: DEFAULTS[name] }));
  }
};

/* ─────────────────────────────── fixtures ────────────────────────────────── */

export const USER_ALICE = "10000000-0000-4000-8000-0000000000a1";
export const USER_BOB = "10000000-0000-4000-8000-0000000000b1";
export const USER_CAROL = "10000000-0000-4000-8000-0000000000c1";
export const USER_DAVE = "10000000-0000-4000-8000-0000000000d1";
export const USER_COACH = "10000000-0000-4000-8000-0000000000c0";

export const COACH_ROW = "20000000-0000-4000-8000-0000000000c1";
export const WORKOUT_ALICE = "30000000-0000-4000-8000-0000000000a1";
export const WORKOUT_BOB = "30000000-0000-4000-8000-0000000000b1";
export const WORKOUT_STRANGER = "30000000-0000-4000-8000-0000000000f1";
export const TEMPLATE_ALICE = "40000000-0000-4000-8000-0000000000a1";

const EPOCH = Date.parse("2026-03-01T00:00:00.000Z");
const HOUR = 3_600_000;

/** A fixed instant relative to the epoch; absolute dates keep the fixtures readable. */
export const at = (hours: number): Date => new Date(EPOCH + hours * HOUR);

/**
 * Resets every table, the id sequence, the Redis store and the event log.
 *
 * Called from `beforeEach`. The repositories are deliberately *not* rebuilt: each
 * one closes over `tables` through a getter rather than capturing the array, so
 * reassigning `tables` here is enough, and swapping the objects would hand Nest
 * a set of repos that are no longer the ones it injected. They are built once,
 * from `buildSocialTestModule`.
 */
export const resetSocialHarness = (): void => {
  seq = 0;
  published.length = 0;
  fakeRedis.flush();
  tables = {
    users: [
      { id: USER_ALICE, name: "Alice", email: "alice@test.com", googlePhotoUrl: "https://cdn.test/alice.png", avatar: null, isDeleted: false },
      { id: USER_BOB, name: "Bob", email: "bob@test.com", googlePhotoUrl: null, avatar: { path: "avatars/bob.png" }, isDeleted: false },
      { id: USER_CAROL, name: "Carol", email: "carol@test.com", googlePhotoUrl: null, avatar: null, isDeleted: false },
      { id: USER_DAVE, name: "Dave", email: "dave@test.com", googlePhotoUrl: null, avatar: null, isDeleted: false },
      { id: USER_COACH, name: "Coach Vera", email: "vera@test.com", googlePhotoUrl: null, avatar: null, isDeleted: false }
    ],
    coaches: [{ id: COACH_ROW, name: "Coach Vera", userId: USER_COACH, isDeleted: false }],
    workouts: [
      { id: WORKOUT_ALICE, userId: USER_ALICE, name: "Alice leg day", startedAt: at(-48), durationSeconds: 3600, isDeleted: false },
      { id: WORKOUT_BOB, userId: USER_BOB, name: "Bob push day", startedAt: at(-40), durationSeconds: 2400, isDeleted: false },
      { id: WORKOUT_STRANGER, userId: USER_DAVE, name: "Dave's secret workout", startedAt: at(-30), durationSeconds: 1800, isDeleted: false }
    ],
    workoutTemplates: [{ id: TEMPLATE_ALICE, userId: USER_ALICE, name: "Alice 5x5", isDeleted: false }],
    posts: [],
    follows: [],
    blocks: [],
    likes: [],
    comments: [],
    reports: []
  };
  for (const row of Object.values(tables).flat()) attachRelations(row);
};

/** Direct row access, for arranging a state that has no HTTP equivalent. */
export const socialTables = (): SocialTables => tables;

/** Inserts a post straight into the table, bypassing the rate limiter. */
export const insertPost = (post: Partial<Row> & { authorId: string }): Row => {
  const row: Row = { ...DEFAULTS.Post(), ...post, id: post.id ?? newId(), createdAt: post.createdAt ?? at(0), updatedAt: at(0) };
  enforceUniqueIndexes("posts", row);
  tables.posts.push(row);
  attachRelations(row);
  return row;
};

/** Inserts a follow edge directly — used to arrange a graph the test does not drive over HTTP. */
export const insertFollow = (followerId: string, followingId: string, createdAt: Date = at(0)): Row => {
  const row: Row = { ...DEFAULTS.Follow(), followerId, followingId, id: newId(), createdAt, updatedAt: createdAt, followedAt: createdAt };
  enforceUniqueIndexes("follows", row);
  tables.follows.push(row);
  attachRelations(row);
  // The production write path invalidates the graph cache; a direct insert
  // must do the same or the next read serves the pre-insert projection.
  void fakeRedis.del(`social:graph:following:${followerId}`, `social:graph:counts:${followerId}`, `social:graph:counts:${followingId}`);
  return row;
};

/* ───────────────────────────── module assembly ───────────────────────────── */

/**
 * Every controller and service in the social platform, wired explicitly.
 *
 * Explicit rather than `imports: [AppModule]` on purpose: the social modules
 * hang off `NotificationsModule` → `AuthModule` → Redis + BullMQ, so importing
 * the real feature modules would make these tests a test of the whole bootstrap
 * (and would need a live Redis). Listing the controllers and providers means the
 * *services under test* — every one of the eight — are the production ones,
 * while only the infrastructure is faked.
 */
export const socialControllers = [PostsController, FeedController, FollowsController, BlocksController, LikesController, CommentsController, ReportsController];

export const socialProviders = (): unknown[] => [
  // Social services
  PostsService,
  PostVisibilityService,
  PostEngagementService,
  PostHydrator,
  FeedService,
  FeedRankingRegistry,
  FollowsService,
  BlocksService,
  SocialGraphService,
  LikesService,
  CommentsService,
  ReportsService,
  // Cross-module social infrastructure (real implementations)
  SocialCacheService,
  SocialRateLimiter,
  SocialUserLoader,
  SocialUserPresenter,
  // Faked infrastructure
  { provide: DataSource, useValue: dataSource },
  { provide: DomainEventPublisher, useValue: domainEventPublisherStub },
  { provide: RedisConnectionFactory, useValue: { createClient: () => fakeRedis, redisUrl: "redis://fake" } },
  { provide: ConfigService, useValue: { get: (key: string) => (key === "APP_URL" ? "https://app.test" : undefined) } },
  // Repositories
  ...(Object.keys(ENTITIES) as EntityName[]).map((name) => ({ provide: getRepositoryToken(ENTITIES[name]), useValue: repoFor(ENTITIES[name]) }))
];

/**
 * The `x-test-user-id` guard.
 *
 * Reads the header and resolves a *real* user row, so `@CurrentUser()` gives the
 * services a `User` with the id the test asked for. It is the same substitution
 * the existing e2e specs make — the point is that it must resolve against the
 * table, not fabricate an object, because `SocialUserPresenter` reads `avatar`
 * and `googlePhotoUrl` off it.
 */
export const socialGuardStub = {
  canActivate: (context: ExecutionContext): boolean => {
    const req = context.switchToHttp().getRequest();
    const userId = (req.headers["x-test-user-id"] as string) ?? USER_ALICE;
    req.user = tables.users.find((user) => user.id === userId) ?? { id: userId, name: userId, avatar: null, googlePhotoUrl: null };
    return true;
  }
};

export const buildSocialTestModule = async (): Promise<TestingModule> => {
  buildRepos();
  return Test.createTestingModule({ controllers: socialControllers, providers: socialProviders() as never[] })
    .overrideGuard(JwtAuthGuard)
    .useValue(socialGuardStub)
    .compile();
};

export const http = (app: { getHttpServer(): App }) => request(app.getHttpServer());

/** Published events, newest last. */
export const recordedEvents = (): readonly RecordedEvent[] => published;

/** Access to the fake Redis client, for cache-behaviour assertions. */
export const socialRedis = fakeRedis;

/** The exact `In`/`IsNull` helpers, re-exported so specs read like the source. */
export { In, IsNull };
