import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "src/modules/posts/entities";
import { PostsModule } from "src/modules/posts/posts.module";
import { PostLike } from "./entities";
import { LikesController } from "./likes.controller";
import { LikesService } from "./likes.service";

/**
 * LIKES MODULE
 * ---------------------------------------------------------------------------
 * Owns `post_likes` — the fact rows, the duplicate-prevention guarantee and the
 * counter bookkeeping. Nothing else.
 *
 * ─── Why the `Post` entity is registered here *and* the row is still owned by
 *     PostsModule ───────────────────────────────────────────────────────────
 * `Post` is registered so this module can (a) load a post to check visibility and
 * (b) read back the counter it just moved. It is registered as a **read** path
 * plus one SELECT, and every write to a post row goes through
 * `PostEngagementService`. Registering the entity is not the same as owning the
 * row, and the alternative — not registering it — would force a cross-module
 * service call just to answer "can this user see this post", which is a worse
 * coupling than a SELECT.
 *
 * Note what this module does *not* import: `FollowsModule`. Blocking is not
 * evaluated here. `PostVisibilityService` already folds the block set into the
 * visibility rule and it is the module that imports the graph, so importing the
 * graph again would give this module a second, independently-invalidated view of
 * a relationship that has exactly one owner. If a future like-path rule needs the
 * graph directly, it belongs in `SocialGraphService` as a method, not in a
 * second import.
 *
 * Nothing is exported. Likes are written and read through HTTP only; no other
 * module needs to ask "did this user like this post", and exporting a service
 * would be an invitation to add one.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PostLike, Post]), PostsModule],
  controllers: [LikesController],
  providers: [LikesService]
})
export class LikesModule {}
