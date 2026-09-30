import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostComment } from "src/modules/comments/entities";
import { Post } from "src/modules/posts/entities";
import { PostsModule } from "src/modules/posts/posts.module";
import { User } from "src/modules/users/entities/user.entity";
import { ContentReport } from "./entities";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * REPORTS MODULE
 * ---------------------------------------------------------------------------
 * The reporting foundation: record, deduplicate, rate-limit, retrieve. It takes
 * no enforcement action, and `ReportsService`'s class comment explains why that
 * is a decision rather than a gap.
 *
 * ─── Dependencies ───────────────────────────────────────────────────────────
 * `PostsModule` is imported for `PostVisibilityService` — the rule that a
 * reporter must be able to see what they report. That is the only thing this
 * module needs from it, and it is the same rule the read path uses, so a report
 * can never be filed against content the reporter could not read.
 *
 * `PostComment` is registered as a repository rather than imported from
 * `CommentsModule`. The reason is the same one stated in `PostsModule`: a report
 * needs to *resolve* a comment (does it exist, who wrote it, what does it say)
 * and that is a read. Importing `CommentsModule` would give this module a
 * dependency on comment *writes* and on the notification pipeline for no benefit,
 * and would make the module graph depend on a module whose only real
 * contribution here is a row lookup.
 *
 * This is the one place in the social platform where that trade is made, and it
 * is bounded to "resolve a comment I can already see". Nothing here writes a
 * comment, so there is exactly one writer of `post_comments` still.
 *
 * Nothing is exported. A moderation tool will need `distinctReporterCount`, and
 * when it exists it will be a separate module with a role check — not a widened
 * public route.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ContentReport, Post, PostComment, User]), PostsModule],
  controllers: [ReportsController],
  providers: [ReportsService]
})
export class ReportsModule {}
