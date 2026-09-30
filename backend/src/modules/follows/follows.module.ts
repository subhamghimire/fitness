import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationsModule } from "src/modules/notifications/notifications.module";
import { User } from "src/modules/users/entities/user.entity";
import { BlocksController } from "./blocks.controller";
import { BlocksService } from "./blocks.service";
import { Follow, UserBlock } from "./entities";
import { FollowsController } from "./follows.controller";
import { FollowsService } from "./follows.service";
import { SocialGraphService } from "./social-graph.service";

/**
 * FOLLOWS MODULE — the social graph (follows + blocks)
 * ---------------------------------------------------------------------------
 * The leaf of the social dependency graph. Posts, likes, comments and the feed
 * all *read* the graph, so this module exports `SocialGraphService` and nothing
 * else; it imports none of them. That arrow is what keeps the module graph
 * acyclic:
 *
 *     follows  ◀──  posts  ◀──  likes / comments / feed
 *                              ◀──  reporting
 *
 * ─── Why blocking lives here, and not in a "safety" module ──────────────────
 * A block is a statement about a *social edge*: it is symmetric in effect,
 * follow-like in shape, and it has to be evaluated on the same read that resolves
 * the follow graph. Splitting it into its own module would mean either a cycle
 * (blocks → follows, and follows → blocks for the pair checks) or a third module
 * both import, for the sake of a name. `SocialGraphService` is the seam instead:
 * one owner of the rows, one owner of the cache invalidation, and no other
 * module ever writes a graph row.
 *
 * ─── `NotificationsModule` is imported for one token ────────────────────────
 * `DomainEventPublisher`, the *abstraction* in `common/events`. `FollowsService`
 * knows that a new follower should be announced and nothing about how that
 * happens. The import supplies the outbox implementation; the dependency still
 * points at `common/events` in the source, so the notification pipeline's
 * internals are not a compile-time concern of this module.
 *
 * `AuthModule` is deliberately *not* imported: guards resolve
 * `JwtAuthGuard`/`CurrentUser` from the global auth wiring, and re-importing it
 * would give this module a second `JwtModule` instance.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Follow, UserBlock, User]), NotificationsModule],
  controllers: [FollowsController, BlocksController],
  providers: [FollowsService, BlocksService, SocialGraphService],
  exports: [SocialGraphService]
})
export class FollowsModule {}
