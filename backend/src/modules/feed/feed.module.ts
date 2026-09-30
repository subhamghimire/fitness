import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PostsModule } from "src/modules/posts/posts.module";
import { Post } from "src/modules/posts/entities";
import { FeedRankingRegistry } from "./feed-ranking";
import { FeedController } from "./feed.controller";
import { FeedService } from "./feed.service";

/**
 * FEED MODULE
 * ---------------------------------------------------------------------------
 * Assembles a feed page. It owns the *scope* vocabulary and the ranking registry,
 * and it owns no SQL of its own beyond "which authors are candidates" — every
 * visibility rule comes from `PostVisibilityService` and every ordering from a
 * `FeedRankingStrategy`.
 *
 * ─── Why the feed is a leaf ─────────────────────────────────────────────────
 * It depends on `PostsModule` (for the visibility rule and the row hydrator) and
 * on nothing else in the social graph. It does **not** import `FollowsModule`
 * directly: the follow set arrives inside the visibility context, resolved by
 * `SocialGraphService` and cached there. That is what keeps one owner of the
 * follow-graph cache — importing the graph here as well would mean two modules
 * could each hold a view of it, and the first bug would be a feed that keeps
 * showing a followed user for a minute after an unfollow, attributed to whichever
 * module happened to be asked.
 *
 * `SocialCacheService` and `SocialUserLoader` need no import: they come from
 * `SocialInfraModule`, which is `@Global()`.
 *
 * Nothing is exported. The feed is a read surface; nothing else in the product
 * needs to ask "what would this user's feed look like", and when something does
 * (a recommendation job, an admin tool), it should ask for a *new* abstraction
 * rather than reaching into this one.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Post]), PostsModule],
  controllers: [FeedController],
  providers: [FeedService, FeedRankingRegistry]
})
export class FeedModule {}
