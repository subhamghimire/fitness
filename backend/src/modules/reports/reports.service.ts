import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, IsNull, Repository } from "typeorm";
import { CursorPageMetaDto } from "src/common/dto";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, toCursorPage } from "src/common/social";
import { excerpt } from "src/common/events";
import { SocialRateLimiter } from "src/shared/social";
import { Post } from "src/modules/posts/entities";
import { PostVisibilityService } from "src/modules/posts/post-visibility.service";
import { PostComment } from "src/modules/comments/entities";
import { User } from "src/modules/users/entities/user.entity";
import { CreateReportDto, ReportPageResponseDto, ReportQueryDto, ReportResponseDto } from "./dto";
import { ContentReport } from "./entities";
import { ReportTargetType } from "./enums";

/** Cursor strategy for a reporter's own history. Ordering is `(created_at, id) DESC`. */
const REPORT_LIST_CURSOR_STRATEGY = "report_created_desc";

/** How much of the reported content is preserved as evidence. */
const TARGET_EXCERPT_MAX = 500;

/** What a report's target turned out to be, resolved and authorised. */
interface ResolvedTarget {
  userId: string | null;
  postId: string | null;
  commentId: string | null;
  targetAuthorId: string | null;
  targetExcerpt: string | null;
}

/**
 * REPORTS SERVICE
 * ---------------------------------------------------------------------------
 * Files a report, deduplicates it, rate-limits it, and shows a reporter their
 * own history. It takes no automated enforcement action, and the reason is
 * stated in `ContentReport`: a report is an unverified signal from an anonymous
 * reporter, and any action taken without a human in the loop is a censorship bug
 * waiting to happen.
 *
 * ─── Rule 1: you can only report what you can see ───────────────────────────
 * Reporting a post or a comment requires the reporter to pass the *same*
 * visibility check that governs reading it (`PostVisibilityService`). This is not
 * pedantry — it is what stops the report endpoint from being an existence oracle.
 * Without it, anyone could feed a list of uuids and learn which of them are real,
 * which posts exist behind a private profile, and whether a specific person is
 * still active.
 *
 * Reporting a **user** has no such check, by design: a user is reportable
 * whether or not you can see their content, because the most important thing to
 * report is frequently behaviour that left no artifact (stalking in DMs,
 * repeated unwanted contact). The 404 is only for an account that does not
 * exist, and reporting yourself is refused outright.
 *
 * ─── Rule 2: one live report per (reporter, target) ─────────────────────────
 * Enforced by `uk_reports_*_dedupe` (one partial unique index per target type).
 * A duplicate returns 409 *and*
 * the existing report, so a client that retries a request whose response was lost
 * gets back the report it already filed rather than an error it cannot act on.
 * That is the whole reason the partial index is on the reporter and not on the
 * target: the guarantee is "this person has already said so", not "this target
 * has been reported".
 *
 * ─── Rule 3: reports are rate-limited hardest of any social action ──────────
 * Five a day, against every other action's hourly or per-minute budget. Filing
 * reports is the one action that is *designed* to be low-volume, so a high rate
 * is not enthusiasm — it is either a broken client looping or an attempt to flood
 * the queue so a real report is buried. The quota is consumed only after the
 * target has been resolved and authorised, so an invalid request cannot burn the
 * reporter's allowance.
 *
 * ─── What the target snapshot is for ────────────────────────────────────────
 * `targetAuthorId` and `targetExcerpt` are captured *now*, while the reporter is
 * demonstrably allowed to see the content. They are the reason a report stays
 * useful after the reported post is deleted — which is exactly when a human needs
 * to act on it. Nothing in the product reads them, and no user other than the
 * reporter can ever see them.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ContentReport) private readonly reportsRepo: Repository<ContentReport>,
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    @InjectRepository(PostComment) private readonly commentsRepo: Repository<PostComment>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly visibility: PostVisibilityService,
    private readonly rateLimiter: SocialRateLimiter
  ) {}

  // ─── Writes ────────────────────────────────────────────────────────────────

  async create(reporterId: string, dto: CreateReportDto): Promise<ReportResponseDto> {
    const target = await this.resolveTarget(reporterId, dto);

    this.rateLimiter.assertAllowed("report", await this.rateLimiter.consume("report", reporterId));

    const details = normalizeDetails(dto.details);
    try {
      const saved = await this.reportsRepo.save(
        this.reportsRepo.create({
          reporterId,
          targetType: dto.targetType,
          userId: target.userId,
          postId: target.postId,
          commentId: target.commentId,
          targetAuthorId: target.targetAuthorId,
          targetExcerpt: target.targetExcerpt,
          reason: dto.reason,
          details,
          isDeleted: false
        })
      );
      return this.toResponse(saved);
    } catch (error) {
      // The partial unique index refused a second report from the same reporter
      // about the same target. Returning the *existing* report is better than a
      // bare 409: a client whose response was lost learns the state it wanted is
      // already true, and can show "already reported" without another round trip.
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findExisting(reporterId, dto);
      if (!existing) throw new ConflictException("You have already reported this");
      return this.toResponse(existing);
    }
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * The caller's own reports, newest first.
   *
   * Scoped to `reporterId` in the query, never by a filter parameter. There is
   * no endpoint that returns everyone's reports: that is a moderation tool's
   * query, and it belongs behind the tool's own authorisation rather than on a
   * public route where forgetting a filter would expose the whole queue.
   */
  async listMine(reporterId: string, query: ReportQueryDto): Promise<ReportPageResponseDto> {
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, REPORT_LIST_CURSOR_STRATEGY) : null;
    const qb = this.reportsRepo
      .createQueryBuilder("report")
      .where("report.reporterId = :reporterId", { reporterId })
      .andWhere('"report"."isDeleted" = false')
      .orderBy("report.createdAt", "DESC")
      .addOrderBy("report.id", "DESC")
      .take(query.limit + 1);
    if (cursor) {
      if (cursor.k.length !== 2) throw new BadRequestException("Malformed cursor");
      qb.andWhere("(report.createdAt, report.id) < (:cursorCreatedAt, :cursorId)", { cursorCreatedAt: new Date(cursor.k[0]), cursorId: cursor.k[1] });
    }
    if (query.status) qb.andWhere("report.status = :status", { status: query.status });
    if (query.targetType) qb.andWhere("report.targetType = :targetType", { targetType: query.targetType });

    const rows = await qb.getMany();
    const page = toCursorPage(rows, query.limit, (row) =>
      encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: REPORT_LIST_CURSOR_STRATEGY, k: [row.createdAt.toISOString(), row.id] })
    );
    const meta: CursorPageMetaDto = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    return { data: rows.slice(0, query.limit).map((row) => this.toResponse(row)), meta };
  }

  /**
   * One of the caller's own reports, or 404.
   *
   * The reporter id is part of the lookup, not a check afterwards. That makes
   * the "someone else's report id is indistinguishable from a nonexistent one"
   * property structural: there is no code path that loads a report without
   * already constraining it to the caller, so there is no 403 to leak.
   */
  async getMine(reporterId: string, reportId: string): Promise<ReportResponseDto> {
    const report = await this.reportsRepo.findOne({ where: { id: reportId, reporterId, isDeleted: false } });
    if (!report) throw new NotFoundException("Report not found");
    return this.toResponse(report);
  }

  /**
   * How many distinct people have reported a given target.
   *
   * Not exposed over HTTP. It exists for the moderation tool and for the
   * threshold logic that tool will eventually use, and it is a `COUNT(DISTINCT
   * reporter_id)` rather than `COUNT(*)` on purpose — the distinction between
   * "eight reports" and "one person filing eight times" is the whole signal, and
   * `uk_reports_*_dedupe` makes the second case impossible from the API but not
   * from the database.
   */
  async distinctReporterCount(target: Pick<CreateReportDto, "targetType" | "userId" | "postId" | "commentId">): Promise<number> {
    const qb = this.reportsRepo.createQueryBuilder("report").where('"report"."isDeleted" = false').andWhere("report.targetType = :targetType", { targetType: target.targetType });
    if (target.targetType === ReportTargetType.USER) qb.andWhere("report.userId = :value", { value: target.userId });
    if (target.targetType === ReportTargetType.POST) qb.andWhere("report.postId = :value", { value: target.postId });
    if (target.targetType === ReportTargetType.COMMENT) qb.andWhere("report.commentId = :value", { value: target.commentId });
    const result = await qb.select("COUNT(DISTINCT report.reporterId)", "count").getRawOne<{ count: string }>();
    return Number(result?.count ?? 0);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Resolves the target and proves the reporter is allowed to see it.
   *
   * The switch is the whole type/reference agreement check, and it is written as
   * a switch rather than as three independent `if`s so that adding a target type
   * is a compile error here instead of a silently unreachable branch.
   */
  private async resolveTarget(reporterId: string, dto: CreateReportDto): Promise<ResolvedTarget> {
    switch (dto.targetType) {
      case ReportTargetType.USER: {
        const userId = dto.userId;
        if (!userId) throw new BadRequestException("userId is required when reporting a user");
        if (userId === reporterId) throw new BadRequestException("You cannot report yourself");
        const user = await this.usersRepo.findOne({ where: { id: userId, isDeleted: false } });
        if (!user) throw new NotFoundException("User not found");
        return { userId, postId: null, commentId: null, targetAuthorId: user.id, targetExcerpt: null };
      }

      case ReportTargetType.POST: {
        const postId = dto.postId;
        if (!postId) throw new BadRequestException("postId is required when reporting a post");
        const post = await this.postsRepo.findOne({ where: { id: postId } });
        if (!post) throw new NotFoundException("Post not found");
        // The reporting equivalent of a 404-on-read. A reporter must be able to
        // see the post to report it; see the class comment.
        this.visibility.assertViewable(post, await this.visibility.contextFor(reporterId));
        return { userId: null, postId, commentId: null, targetAuthorId: post.authorId, targetExcerpt: post.body ? excerpt(post.body, TARGET_EXCERPT_MAX) : null };
      }

      case ReportTargetType.COMMENT: {
        const commentId = dto.commentId;
        if (!commentId) throw new BadRequestException("commentId is required when reporting a comment");
        const comment = await this.commentsRepo.findOne({ where: { id: commentId } });
        if (!comment) throw new NotFoundException("Comment not found");
        // A comment inherits its post's visibility, and that includes the
        // "you wrote it, so you can always see it" rule — which is why a report
        // on your own comment is allowed. You are the one who can describe why
        // it is a problem.
        this.visibility.assertViewable(comment.post, await this.visibility.contextFor(reporterId));
        if (comment.isDeleted && comment.authorId !== reporterId) throw new NotFoundException("Comment not found");
        return { userId: null, postId: null, commentId, targetAuthorId: comment.authorId, targetExcerpt: excerpt(comment.body, TARGET_EXCERPT_MAX) };
      }

      default:
        throw new BadRequestException("Unsupported report target");
    }
  }

  /**
   * The live report this reporter already filed for this target, if any.
   *
   * The `IsNull()` calls are load-bearing rather than decorative. In a
   * `FindOptionsWhere`, a bare `null` is *ignored* by TypeORM (it does not become
   * `IS NULL`), so a where object built with `userId: null` would match any
   * report that merely has no `userId` set — which is every POST and COMMENT
   * report. The predicate has to be explicit.
   */
  private findExisting(reporterId: string, dto: CreateReportDto): Promise<ContentReport | null> {
    const where: FindOptionsWhere<ContentReport> = { reporterId, targetType: dto.targetType, isDeleted: false, userId: IsNull(), postId: IsNull(), commentId: IsNull() };
    if (dto.targetType === ReportTargetType.USER) where.userId = dto.userId ?? IsNull();
    if (dto.targetType === ReportTargetType.POST) where.postId = dto.postId ?? IsNull();
    if (dto.targetType === ReportTargetType.COMMENT) where.commentId = dto.commentId ?? IsNull();
    return this.reportsRepo.findOne({ where });
  }

  /**
   * The report as its author sees it.
   *
   * Note the absence of `reporterId` and `resolutionNote`. A reporter is told
   * *that* something was reported and where it is in triage, and nothing about
   * the internal handling of it: a note describing an enforcement action would
   * tell the reporter exactly how much friction a given complaint causes, which
   * is an incentive to complain more and a way to probe the system.
   */
  private toResponse(row: ContentReport): ReportResponseDto {
    return {
      id: row.id,
      targetType: row.targetType,
      userId: row.userId,
      postId: row.postId,
      commentId: row.commentId,
      reason: row.reason,
      details: row.details,
      status: row.status,
      targetAuthorId: row.targetAuthorId,
      targetExcerpt: row.targetExcerpt,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt
    };
  }
}

/** Postgres 23505 — the partial unique index refused a duplicate report. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function normalizeDetails(details: string | undefined): string | null {
  const trimmed = details?.trim();
  return trimmed ? trimmed : null;
}
