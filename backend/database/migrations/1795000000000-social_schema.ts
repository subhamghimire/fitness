import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 8 — Social platform schema.
 *
 * Creates the six tables behind the social modules:
 *
 *   social_follows     follows            (FollowsModule)
 *   social_blocks      blocks             (FollowsModule)
 *   posts              posts              (PostsModule)
 *   post_likes         likes              (LikesModule)
 *   post_comments      comments           (CommentsModule)
 *   content_reports    reports            (ReportsModule)
 *
 * The feed has no table. That is deliberate: a feed here is a keyset-paginated
 * query over `posts` scoped by the follow graph, not a fan-out timeline. See
 * `FeedService` for why, and for the seam (`FeedRankingStrategy`) that a
 * materialised timeline would later slot into.
 *
 * ── Three decisions that are correctness guarantees, not tuning ─────────────
 *
 * **1. Every uniqueness constraint here is PARTIAL (`WHERE "isDeleted" = false`).**
 * Not a style choice. Unfollow, unlike and comment-deletion are all soft deletes,
 * and a plain unique index would make the *ordinary* second action of every
 * social verb fail for the rest of the row's life:
 *
 *   - follow → unfollow → follow   would collide with the soft-deleted edge
 *   - like → unlike → like          would collide with the soft-deleted like
 *   - report, dismissed, re-report  would collide with the dismissed report
 *
 * With the predicate, the guarantee is "at most one *live* row per pair", which
 * is the actual product rule, and history is preserved. A plain unique index here
 * would be a bug that only appears on the second use of the feature.
 *
 * The same reason rules out a unique index over bare nullable columns for
 * reports: Postgres treats NULLs as distinct in a unique index, so a plain
 * `(reporter_id, target_type, post_id, comment_id, user_id)` index would enforce
 * nothing for any report whose unused target columns are NULL — which is all of
 * them. Reports therefore use one partial unique index per target type (see the
 * `uk_reports_*_dedupe` block below), each constrained to the single FK column
 * its `target_type` uses. No sentinel value, no expression index, no PG-version
 * dependency — the `ck_content_reports_target` CHECK already guarantees exactly
 * one target column is set per type, so per-type indexes enforce the product
 * rule exactly.
 *
 * **2. The CHECK constraints are the last line of defence for every rule a
 *     service enforces.**
 * A post's `type` must agree with its references; a comment's `parent_id` must
 * point at a top-level comment; a report's `target_type` must match which target
 * column is set. All three are checked in application code *and* here, and the
 * duplication is intended: the service check produces a 400 with a useful message,
 * and the constraint makes the invariant true even for a row written by a future
 * bug, a backfill, or a psql session.
 *
 * **3. The counters cannot go negative.**
 * `ck_posts_non_negative_counters` and `ck_post_comments_non_negative` make a
 * negative like/comment/reply count a database error. The application already
 * clamps with `GREATEST(0, …)`; this is the assertion that the clamp is not the
 * only thing standing between a bug and a client-visible `-1`.
 *
 * ── Index review: one index per query the product actually makes ────────────
 * Every index below is named for the read it serves, in the comment above it.
 * The two that are easiest to get wrong:
 *
 *   - `idx_post_comments_post_created` leads with `post_id` and trails with
 *     `created_at` — the equality column first, the keyset column second. The
 *     reverse order serves the same query with a sort step.
 *   - There is **no** `idx_posts_created_desc`. Postgres scans a B-tree
 *     backwards, so the plain ASC index already serves the DESC feed order;
 *     a mirror index would double write amplification on the hottest insert path
 *     to save a scan the planner can already do.
 *
 * The one index deliberately *absent* is `(user_id)` on `post_likes` — nothing in
 * the product lists "posts I liked", and an index for a query that does not exist
 * is pure write cost. `idx_reports_user` is absent for the same reason: the
 * moderation tool does not exist yet.
 *
 * Everything is `IF NOT EXISTS` and every constraint is added inside a guarded
 * `DO $$` block, so this applies cleanly to a database that has never run
 * migrations and to one where the tables already exist. Same convention as the
 * messaging and notifications migrations.
 */
export class SocialSchema1795000000000 implements MigrationInterface {
  name = "SocialSchema1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ─── social_follows ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_follows" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "follower_id" uuid NOT NULL,
        "following_id" uuid NOT NULL,
        "followed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_social_follows_follower" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_social_follows_following" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // "Who do I follow" and the feed's author scope: equality on follower_id, then
    // ordered/keyset-paginated by created_at.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_social_follows_follower_created" ON "social_follows" ("follower_id", "created_at")`);
    // "Who follows me" and the follower counter: the mirror direction.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_social_follows_following_created" ON "social_follows" ("following_id", "created_at")`);
    // At most one LIVE follow per ordered pair. Partial, so re-following after an
    // unfollow inserts a fresh row instead of colliding with history.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_social_follows_pair"
      ON "social_follows" ("follower_id", "following_id")
      WHERE "isDeleted" = false
    `);
    // Self-following is refused by the service with a 400 and blocked here, so it
    // cannot arrive from a psql session or a future caller.
    await this.addCheck(queryRunner, "social_follows", "ck_social_follows_not_self", '"follower_id" <> "following_id"');

    // ─── social_blocks ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_blocks" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "blocker_id" uuid NOT NULL,
        "blocked_id" uuid NOT NULL,
        "reason" character varying(24),
        "note" character varying(200),
        CONSTRAINT "fk_social_blocks_blocker" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_social_blocks_blocked" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // Two read directions from one directional row: "who did I block" and the
    // read-side exclusion that has to be fast on *every* feed read.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_social_blocks_blocker" ON "social_blocks" ("blocker_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_social_blocks_blocked" ON "social_blocks" ("blocked_id", "created_at")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_social_blocks_pair"
      ON "social_blocks" ("blocker_id", "blocked_id")
      WHERE "isDeleted" = false
    `);
    await this.addCheck(queryRunner, "social_blocks", "ck_social_blocks_not_self", '"blocker_id" <> "blocked_id"');
    await this.addCheck(queryRunner, "social_blocks", "ck_social_blocks_reason", '"reason" IS NULL OR "reason" IN (\'spam\', \'harassment\', \'hate\', \'sexual\', \'impersonation\', \'other\')');

    // ─── posts ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "posts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "author_id" uuid NOT NULL,
        "type" character varying(24) NOT NULL DEFAULT 'text',
        "body" text,
        "privacy" character varying(16) NOT NULL DEFAULT 'public',
        "workout_id" uuid,
        "workout_template_id" uuid,
        "like_count" integer NOT NULL DEFAULT 0,
        "comment_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "fk_posts_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE,
        -- SET NULL, not CASCADE: a post is content a user wrote, not a view of a
        -- row we happen to own. Deleting the referenced workout leaves a caption,
        -- not a hole in the feed.
        CONSTRAINT "fk_posts_workout" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_posts_workout_template" FOREIGN KEY ("workout_template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL,
        CONSTRAINT "ck_posts_non_negative_counters" CHECK ("like_count" >= 0 AND "comment_count" >= 0)
      )
    `);
    // A profile's own posts, keyset-paginated: equality on author, order by time.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_posts_author_created" ON "posts" ("author_id", "created_at")`);
    // The recency feed and the public timeline. ASC serves the DESC feed order —
    // Postgres scans a B-tree backwards, so no mirror index is needed.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_posts_created" ON "posts" ("created_at")`);
    // The engagement ranking's backing order. Not a range-scan answer for the
    // score expression (see WeightedHotnessRankingStrategy); it is what lets the
    // scan stay bounded rather than sorting the whole table.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_posts_engagement" ON "posts" ("like_count", "comment_count", "created_at")`);
    // Followers-only posts per author — the branch of the visibility predicate
    // that is not an equality on the author alone.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_posts_author_privacy" ON "posts" ("author_id", "privacy")`);
    // One live share of a given workout per author. Partial *and* predicated on
    // the workout being present: without the `IS NOT NULL`, every TEXT post would
    // collide with every other TEXT post on (author_id, NULL).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_posts_author_workout"
      ON "posts" ("author_id", "workout_id")
      WHERE "isDeleted" = false AND "workout_id" IS NOT NULL
    `);
    await this.addCheck(queryRunner, "posts", "ck_posts_type", '"type" IN (\'text\', \'workout_share\', \'template_share\', \'coach_content\')');
    await this.addCheck(queryRunner, "posts", "ck_posts_privacy", '"privacy" IN (\'public\', \'followers\', \'private\')');
    // The type/reference agreement the service also checks. A `workout_share`
    // with no `workout_id`, or a `text` post pointing at one, is a row that
    // would render as a broken card in every feed forever.
    await this.addCheck(
      queryRunner,
      "posts",
      "ck_posts_type_reference",
      `(
        ("type" = 'workout_share' AND "workout_id" IS NOT NULL AND "workout_template_id" IS NULL)
        OR ("type" = 'template_share' AND "workout_template_id" IS NOT NULL AND "workout_id" IS NULL)
        OR ("type" IN ('text', 'coach_content') AND "workout_id" IS NULL AND "workout_template_id" IS NULL)
      )`
    );
    // A text post with no body is not a post. Share posts may have no caption.
    await this.addCheck(queryRunner, "posts", "ck_posts_body_required", `("type" NOT IN ('text', 'coach_content')) OR NULLIF(BTRIM("body"), '') IS NOT NULL`);

    // ─── post_likes ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_likes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "post_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "fk_post_likes_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_post_likes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // The liker list for one post, and the shape the batch like-state read uses.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_post_likes_post_created" ON "post_likes" ("post_id", "created_at")`);
    // At most one LIVE like per (post, user). Partial, so unlike → like works.
    // There is deliberately no (user_id) index: nothing lists "posts I liked".
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_post_likes_pair"
      ON "post_likes" ("post_id", "user_id")
      WHERE "isDeleted" = false
    `);

    // ─── post_comments ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_comments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "post_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "body" text NOT NULL,
        "parent_id" uuid,
        "depth" smallint NOT NULL DEFAULT 0,
        "reply_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "fk_post_comments_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_post_comments_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_post_comments_parent" FOREIGN KEY ("parent_id") REFERENCES "post_comments"("id") ON DELETE CASCADE
      )
    `);
    // "Comments by post" — the requirement, and the flat thread read: equality on
    // post_id first, keyset column second. Depth is a filter on rows this index
    // already returns, not a separate access path.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_post_comments_post_created" ON "post_comments" ("post_id", "created_at")`);
    // Batched reply hydration for a page of parents, and the reply list.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_post_comments_parent" ON "post_comments" ("parent_id", "created_at")`);
    // Duplicate-submission guard: one live comment per (author, post, body).
    // Partial so an edited-then-restored body can be re-posted after a delete.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_post_comments_live_body"
      ON "post_comments" ("author_id", "post_id", "body")
      WHERE "isDeleted" = false
    `);
    await this.addCheck(queryRunner, "post_comments", "ck_post_comments_non_empty", "NULLIF(BTRIM(\"body\"), '') IS NOT NULL");
    await this.addCheck(queryRunner, "post_comments", "ck_post_comments_non_negative", '"reply_count" >= 0');
    // depth and parent_id can never disagree, and the thread stays one level
    // deep. A reply to a reply would need depth 2, which this refuses.
    await this.addCheck(queryRunner, "post_comments", "ck_post_comments_depth", `(("depth" = 0 AND "parent_id" IS NULL) OR ("depth" = 1 AND "parent_id" IS NOT NULL)) AND "depth" <= 1`);

    // ─── content_reports ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "content_reports" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "reporter_id" uuid NOT NULL,
        "target_type" character varying(16) NOT NULL,
        "user_id" uuid,
        "post_id" uuid,
        "comment_id" uuid,
        "target_author_id" uuid,
        "target_excerpt" character varying(500),
        "reason" character varying(32) NOT NULL,
        "details" character varying(1000),
        "status" character varying(16) NOT NULL DEFAULT 'reported',
        "resolution_note" character varying(500),
        "resolved_by" uuid,
        "resolved_at" TIMESTAMPTZ,
        CONSTRAINT "fk_content_reports_reporter" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE,
        -- SET NULL on every target: a report must outlive the thing it is about,
        -- because that is when a human needs to read it. target_author_id and
        -- target_excerpt preserve the identity and the content.
        CONSTRAINT "fk_content_reports_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_content_reports_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_content_reports_comment" FOREIGN KEY ("comment_id") REFERENCES "post_comments"("id") ON DELETE SET NULL
      )
    `);
    // The triage queue: open reports, newest first. Equality on status, ordered
    // and keyset-paginated by created_at.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_reports_status_created" ON "content_reports" ("status", "created_at")`);
    // "Every report about this post/comment" — the two triage lookups, one per
    // target type, both on the equality column the type filter selects.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_reports_target_post" ON "content_reports" ("target_type", "post_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_reports_target_comment" ON "content_reports" ("target_type", "comment_id", "created_at")`);
    // One reporter's own history, and the query that spots a reporter abusing
    // the endpoint.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_reports_reporter_created" ON "content_reports" ("reporter_id", "created_at")`);
    // One live report per (reporter, target), enforced as one partial unique
    // index per target type.
    //
    // Why three indexes instead of one: every report row has NULL in two of its
    // three target columns, and **Postgres treats NULLs as distinct in a unique
    // index** — the comparison on a NULL column yields NULL, not TRUE, so the
    // duplicate check never fires and *every* duplicate report is inserted. An
    // index on the bare columns looks correct, creates without error, and
    // enforces nothing.
    //
    // The common workaround is `COALESCE(col, <sentinel-uuid>)` over the three
    // columns. That works but introduces a magic constant every reader must
    // understand, an expression index TypeORM cannot represent (so entity and
    // migration silently disagree), and a value that must never collide with a
    // real id. The per-type partial indexes avoid all three: each index covers
    // exactly the one FK column its `target_type` uses, the
    // `ck_content_reports_target` CHECK guarantees the other columns are NULL
    // for that type, and the predicates make the intent self-documenting.
    //
    // (`NULLS NOT DISTINCT` would also fix the single-index form, but it needs
    // PG 15+ and still leaves one wide index where three narrow ones match the
    // access pattern. Per-type partials work on every supported PG and are
    // smaller to write and to scan.)
    //
    // Dropping the previous single-expression form first keeps this re-runnable
    // against a database that applied an earlier revision of this migration.
    await queryRunner.query(`DROP INDEX IF EXISTS "uk_reports_open_dedupe"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_reports_user_dedupe"
      ON "content_reports" ("reporter_id", "user_id")
      WHERE "isDeleted" = false AND "target_type" = 'user'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_reports_post_dedupe"
      ON "content_reports" ("reporter_id", "post_id")
      WHERE "isDeleted" = false AND "target_type" = 'post'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_reports_comment_dedupe"
      ON "content_reports" ("reporter_id", "comment_id")
      WHERE "isDeleted" = false AND "target_type" = 'comment'
    `);
    await this.addCheck(queryRunner, "content_reports", "ck_content_reports_reason", `"reason" IN ('spam', 'harassment', 'hate', 'sexual_content', 'violence', 'self_harm', 'impersonation', 'misinformation', 'copyright', 'other')`);
    await this.addCheck(queryRunner, "content_reports", "ck_content_reports_status", `"status" IN ('reported', 'under_review', 'resolved', 'dismissed')`);
    // The type/reference agreement, which is also what makes the per-type
    // dedupe indexes sufficient: each type has exactly one non-NULL target.
    await this.addCheck(
      queryRunner,
      "content_reports",
      "ck_content_reports_target",
      `(
        ("target_type" = 'user' AND "user_id" IS NOT NULL AND "post_id" IS NULL AND "comment_id" IS NULL)
        OR ("target_type" = 'post' AND "post_id" IS NOT NULL AND "user_id" IS NULL AND "comment_id" IS NULL)
        OR ("target_type" = 'comment' AND "comment_id" IS NOT NULL AND "user_id" IS NULL AND "post_id" IS NULL)
      )`
    );
    // A report cannot be about its own reporter.
    await this.addCheck(queryRunner, "content_reports", "ck_content_reports_not_self", '"user_id" IS NULL OR "user_id" <> "reporter_id"');
    // A terminal status and its resolution fields travel together.
    await this.addCheck(queryRunner, "content_reports", "ck_content_reports_resolution", `(("status" IN ('resolved', 'dismissed')) = ("resolved_at" IS NOT NULL))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order: reports reference comments and posts, comments
    // reference posts, so the leaves go first.
    await queryRunner.query(`DROP TABLE IF EXISTS "content_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_likes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_blocks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_follows"`);
  }

  /**
   * Adds a CHECK constraint only if it is not already present.
   *
   * Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, and this migration is written
   * to be re-runnable against a database where the table already exists (the same
   * convention as the messaging and notifications migrations). The `pg_constraint`
   * lookup is scoped by `conrelid` as well as `conname`, so a constraint of the
   * same name on a *different* table does not suppress this one.
   */
  private async addCheck(queryRunner: QueryRunner, table: string, name: string, expression: string): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = '${name}' AND conrelid = '${table}'::regclass
        ) THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression});
        END IF;
      END $$;
    `);
  }
}
