import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { Post } from "src/modules/posts/entities";
import { PostComment } from "src/modules/comments/entities";
import { ReportReason, ReportStatus, ReportTargetType } from "../enums";

/**
 * CONTENT REPORT — one user's report that something violates the rules.
 *
 * ─── Why this is a "foundation" and not a moderation system ──────────────────
 * It records a report faithfully, deduplicates them, rate-limits them, and makes
 * them retrievable. It deliberately does **not** auto-hide content, auto-mute a
 * user, or decide that anything is actionable. That is the right line to draw
 * now, because every automated action taken on an un-reviewed report is a
 * censorship bug waiting to happen, and the reporter is an anonymous, unverified
 * signal — a determined actor can file a thousand of them.
 *
 * What it does provide is the thing a moderation queue actually needs: a
 * durable, deduplicated, ordered record with the reporter's own words attached.
 *
 * ─── Target columns: three nullable FKs, not a polymorphic `target_id` ───────
 * A `(target_type, target_id)` pair with no foreign key is the usual shortcut and
 * it is wrong here for three reasons:
 *
 *   1. **It cannot cascade.** Deleting a post would leave a report pointing at
 *      nothing — and a report is precisely the thing that must survive the
 *      content, because that is when it gets looked at. Each real FK here is
 *      `ON DELETE SET NULL` plus a *snapshot* of the target's identity
 *      (`targetAuthorId`, `targetBody`), so a report against a deleted post is
 *      still readable and still names who wrote it.
 *   2. **It cannot be constrained.** A CHECK constraint can say "a POST report
 *      must have a `post_id` and no `comment_id`"; it cannot say anything about a
 *      bare uuid. The three-column shape makes the type/reference agreement a
 *      database invariant.
 *   3. **It makes the triage query slow.** "Every open report about posts" is the
 *      queue's main query, and it becomes a join against a uuid column with no
 *      index rather than an indexed seek on a real FK.
 *
 * The cost is three columns and a CHECK. That is a cheap price for referential
 * integrity in the one table that must not silently lose rows.
 *
 * ─── Indexes: the three questions triage actually asks ─────────────────────
 *   idx_reports_status_created  — the queue: "open reports, newest first". The
 *     leading column is the filter, `created_at` is the sort and the keyset.
 *   idx_reports_target_post     — "every report against this post", and the
 *     per-post counter that decides whether it goes to review.
 *   idx_reports_target_comment  — same, for comments.
 *   idx_reports_reporter_created — one user's own report history, for "have I
 *     already reported this?" and for spotting a reporter abusing the endpoint.
 *   uk_reports_*_dedupe       — three partials, one per target type: see below.
 *
 * There is deliberately no index on `user_id` (report a user) because nothing
 * reads it yet; it earns one when the triage tool exists, alongside the index it
 * will need.
 *
 * ─── `uk_reports_*_dedupe` — why three partials, and why it matters ─────────
 * The rule: **one live report per (reporter, target)**. A reporter who files the
 * same report forty times must not be able to inflate a post's report count into
 * something that looks like forty independent people were alarmed — which is both
 * a moderation-integrity problem and a cheap denial-of-service against a
 * specific user.
 *
 * Each has to be partial, and for the same reason as every other unique index in
 * this platform: a dismissed report should not permanently prevent the reporter
 * from ever reporting that thing again. (If the first report was wrong, or was
 * resolved and the behaviour recurred, filing again must be possible.) The
 * predicate is `isDeleted = false`, which is satisfied by *every* report including
 * resolved ones — and that is intentional. The uniqueness is about the
 * *reporter*, not about the outcome: one person files one report per target, and
 * triage decides what happens to it. A second report is refused with a 409 and
 * the existing report id is returned, so a client can show "you have already
 * reported this" without a lookup.
 *
 * ─── Why one index per target type instead of a single expression index ─────
 * Every report row leaves two of its three target columns NULL, and Postgres
 * treats NULLs as **distinct** in a unique index — a unique index on the bare
 * columns creates without error and enforces *nothing*, silently, forever. That
 * is the worst kind of bug: the constraint looks like it is there.
 *
 * The usual fix is `COALESCE(col, <sentinel-uuid>)`. It works, but it needs a
 * magic constant, an expression index TypeORM's `@Index` cannot express (so the
 * entity and the migration disagree), and a value that must never collide with
 * a real id. One partial index per target type needs none of that: each index
 * covers exactly the FK column its `target_type` uses, the
 * `ck_content_reports_target` CHECK below guarantees the other two are NULL for
 * that type, and the predicates state the rule in plain SQL. Portable across PG
 * versions, narrower to write and scan, and representable (modulo the partial
 * predicate) in the decorators below.
 */
@Entity("content_reports")
@Index("idx_reports_status_created", ["status", "createdAt"])
@Index("idx_reports_target_post", ["targetType", "postId", "createdAt"])
@Index("idx_reports_target_comment", ["targetType", "commentId", "createdAt"])
@Index("idx_reports_reporter_created", ["reporterId", "createdAt"])
// One partial unique index per target type. The migration is authoritative for
// the partial predicates (`synchronize` is `false`); these decorators document
// the constraint shape at the entity so a schema diff has something to
// reconcile against.
@Index("uk_reports_user_dedupe", ["reporterId", "userId"], { unique: true, where: '"isDeleted" = false' })
@Index("uk_reports_post_dedupe", ["reporterId", "postId"], { unique: true, where: '"isDeleted" = false' })
@Index("uk_reports_comment_dedupe", ["reporterId", "commentId"], { unique: true, where: '"isDeleted" = false' })
export class ContentReport extends AbstractEntity {
  // ─── Who reported, and when ────────────────────────────────────────────────

  @Column({ name: "reporter_id", type: "uuid" })
  reporterId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "reporter_id" })
  reporter: User;

  // ─── What was reported ─────────────────────────────────────────────────────

  @Column({ name: "target_type", type: "varchar", length: 16 })
  targetType: ReportTargetType;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user: User | null;

  @Column({ name: "post_id", type: "uuid", nullable: true })
  postId: string | null;

  @ManyToOne(() => Post, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "post_id" })
  post: Post | null;

  @Column({ name: "comment_id", type: "uuid", nullable: true })
  commentId: string | null;

  @ManyToOne(() => PostComment, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "comment_id" })
  comment: PostComment | null;

  // ─── Why ───────────────────────────────────────────────────────────────────

  @Column({ type: "varchar", length: 32 })
  reason: ReportReason;

  /**
   * The reporter's own words. Optional by design: a closed reason list is the
   * triage signal, and forcing a paragraph makes people click through rather
   * than report. Length-bounded in the DTO and by the column type.
   */
  @Column({ type: "varchar", length: 1000, nullable: true })
  details: string | null;

  // ─── Snapshot of the target, so the report survives its target ────────────

  /**
   * Who wrote the reported thing, captured at report time.
   *
   * Not derivable later: if the target is deleted, the report has no author to
   * show, and the one question triage always asks — "who wrote this?" — becomes
   * unanswerable. This is why `ON DELETE SET NULL` on the target is safe.
   */
  @Column({ name: "target_author_id", type: "uuid", nullable: true })
  targetAuthorId: string | null;

  /**
   * A bounded excerpt of the reported content, captured at report time.
   *
   * This is content *a reporter was allowed to see*, preserved at the moment a
   * human said "somebody should look at this". It is the evidence. It is
   * truncated by the CHECK/DTO limits and is never surfaced to any user — only
   * to the reporter, in their own report history, and to moderation tooling.
   */
  @Column({ name: "target_excerpt", type: "varchar", length: 500, nullable: true })
  targetExcerpt: string | null;

  // ─── Triage ────────────────────────────────────────────────────────────────

  @Column({ type: "varchar", length: 16, default: ReportStatus.REPORTED })
  status: ReportStatus;

  /**
   * Set when a human acts. Free text, nullable, and — like `UserBlock.reason` —
   * advisory: it records what a moderator did, and nothing in enforcement may
   * branch on it.
   */
  @Column({ name: "resolution_note", type: "varchar", length: 500, nullable: true })
  resolutionNote: string | null;

  @Column({ name: "resolved_by", type: "uuid", nullable: true })
  resolvedBy: string | null;

  @Column({ name: "resolved_at", type: "timestamptz", nullable: true })
  resolvedAt: Date | null;
}
