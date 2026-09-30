import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";
import { FollowsModule } from "src/modules/follows/follows.module";
import { Post } from "./entities";
import { PostEngagementService } from "./post-engagement.service";
import { PostHydrator } from "./post-hydrator.service";
import { PostVisibilityService } from "./post-visibility.service";
import { PostsController } from "./posts.controller";
import { PostsService } from "./posts.service";

/**
 * POSTS MODULE
 * ---------------------------------------------------------------------------
 * Owns the `posts` table and every rule about what a post *is*: its type, the
 * consistency between type and reference, the immutable fields, and who may see
 * it. It does **not** own likes, comments or ranking.
 *
 * ─── The one-way arrow that keeps the module graph a DAG ────────────────────
 *
 *     FollowsModule ──▶ PostsModule ──▶ LikesModule
 *                              └──────▶ CommentsModule
 *                              └──────▶ FeedModule
 *
 * `PostVisibilityService` needs the graph, so `FollowsModule` is imported. The
 * engagement counters are the other direction of the same question: likes and
 * comments must move `posts.like_count` / `posts.comment_count`, so *they*
 * import *this* module — and they import it as a **service**
 * (`PostEngagementService`), never as the `Post` repository. That asymmetry is
 * the whole reason there is no cycle: a module may ask the owner of a row to
 * mutate it, but the row's owner never reaches back.
 *
 * ─── Why workout/template entities are registered read-only here ─────────────
 * A shared post must be able to render a card for the workout it references, and
 * to verify the author *owns* it. Those are the only two reasons, and both are
 * reads. The alternative — calling into `WorkoutModule` — would make social the
 * owner of a cross-module join, and would mean the social layer could grow write
 * paths into workout data. `WorkoutModule` is not imported and does not know
 * posts exist; the arrow is `posts ──▶ workouts` and only `posts` holds it.
 * This is the "a workout can be referenced by Social, but Social owns the social
 * behaviour" rule, made structural.
 *
 * ─── What is exported, and why exactly these three ─────────────────────────
 *   `PostVisibilityService` — the single implementation of the visibility rule.
 *     The feed must apply the *same* rule, or a post invisible in a profile
 *     becomes visible in the feed.
 *   `PostEngagementService`  — the only sanctioned way to move a counter.
 *   `PostHydrator`           — the only way to build a `PostResponseDto`.
 *
 * Nothing else is exported. `PostsService` is deliberately private to the HTTP
 * layer so that "create a post" cannot be reached by another module with a
 * different rate limit, validation path or event behaviour than the endpoint
 * guarantees.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Post, Workout, WorkoutTemplate, Coach, User]), FollowsModule],
  controllers: [PostsController],
  providers: [PostsService, PostVisibilityService, PostEngagementService, PostHydrator],
  exports: [PostVisibilityService, PostEngagementService, PostHydrator]
})
export class PostsModule {}
