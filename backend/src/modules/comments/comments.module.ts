import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationsModule } from "src/modules/notifications/notifications.module";
import { Post } from "src/modules/posts/entities";
import { PostsModule } from "src/modules/posts/posts.module";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";
import { PostComment } from "./entities";

/**
 * COMMENTS MODULE
 * ---------------------------------------------------------------------------
 * Owns `post_comments`, the one-level thread, and the two counters it implies.
 *
 * ─── Dependencies, and the one that is deliberately missing ─────────────────
 *
 *     PostsModule ──▶ CommentsModule
 *
 * `PostsModule` is imported for exactly two reasons, and both are narrow:
 * `PostVisibilityService` (a comment inherits its post's visibility, and there
 * must be one implementation of that rule) and `PostEngagementService` (moving
 * `posts.comment_count` on the caller's transaction).
 *
 * `NotificationsModule` is imported for one token: `DomainEventPublisher`, the
 * abstraction in `common/events`. `CommentsService` knows that a new comment
 * should notify somebody and nothing about how; the import supplies the outbox
 * implementation. The source-level dependency is on `common/events`, so the
 * notification pipeline's internals are not a compile-time concern here — the
 * same arrangement `FollowsModule` uses.
 *
 * `FollowsModule` is **not** imported, and that is a decision rather than an
 * oversight. Blocking is already folded into `PostVisibilityService`, which is
 * the one rule this module needs. Importing the graph as well would mean this
 * module could read the follow/block relationship through a second, separately
 * invalidated path — and the first bug report that produces is "a blocked user's
 * comment is still visible", caused by one code path using a cached set and the
 * other a fresh read.
 *
 * Nothing is exported: comments are read and written through their own routes,
 * and no other module has a reason to ask "what are the comments on this post".
 */
@Module({
  imports: [TypeOrmModule.forFeature([PostComment, Post]), PostsModule, NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService]
})
export class CommentsModule {}
