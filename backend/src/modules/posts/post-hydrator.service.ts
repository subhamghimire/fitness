import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { SocialUserLoader, SocialUserPresenter } from "src/shared/social";
import { User } from "src/modules/users/entities/user.entity";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";
import { PostResponseDto, PostTemplateRefDto, PostWorkoutRefDto } from "./dto";
import { Post } from "./entities";

/**
 * POST HYDRATOR
 * ---------------------------------------------------------------------------
 * Turns `Post` rows into the API shape, in a *fixed* number of queries — one for
 * the authors, one for the referenced workouts, one for the referenced templates
 * — no matter how many rows it is given.
 *
 * ─── Why this is a service and not a private method on `PostsService` ───────
 * Three modules render posts: `PostsService` (profile and timeline lists) and
 * `FeedModule` (every ranking strategy). If the mapping lived on `PostsService`
 * and were exported, the feed would be reaching into a service for what is
 * fundamentally a read-model concern, and the *shape* of a post — which is a
 * privacy surface, see below — would be maintained in two places.
 *
 * Keeping it here also puts the privacy decision in one file: a post response
 * carries a `SocialUserSummaryDto` and a deliberately thin workout projection,
 * and never an email, a workout's notes, or any field the presenter does not
 * explicitly allow. That is enforced structurally — the only way to build a
 * `PostResponseDto` is through this class, and it copies named fields.
 *
 * ─── The referenced rows are loaded by `In([...])`, not by a join ───────────
 * A join would multiply page rows and would mean a page could return fewer than
 * `limit` distinct posts because of a join fan-out — which breaks the keyset
 * contract (the cursor would skip posts). `In` keeps every query a plain
 * indexed lookup and keeps the row set exactly what the ordering produced.
 */
@Injectable()
export class PostHydrator {
  constructor(
    @InjectRepository(Workout) private readonly workoutsRepo: Repository<Workout>,
    @InjectRepository(WorkoutTemplate) private readonly templatesRepo: Repository<WorkoutTemplate>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly userLoader: SocialUserLoader,
    private readonly userPresenter: SocialUserPresenter
  ) {}

  /**
   * Maps an ordered row set to responses, preserving order.
   *
   * A row whose author no longer resolves is **dropped, not faked**. Hydration
   * reads the user table outside the post query's transaction, so a user deleted
   * in between would otherwise produce a response with a placeholder identity.
   * Dropping is the honest outcome: `users.id` is the post's `ON DELETE CASCADE`
   * target, so a surviving post always has a surviving author, and a dropped row
   * can only be a race or a corruption — both of which should be visible as a
   * missing post rather than as a ghost author.
   */
  async toResponses(rows: Post[], viewerId: string): Promise<PostResponseDto[]> {
    if (rows.length === 0) return [];
    const [authors, workouts, templates] = await Promise.all([
      this.userLoader.loadByIds(rows.map((post) => post.authorId)),
      this.loadWorkoutRefs(rows.map((post) => post.workoutId)),
      this.loadTemplateRefs(rows.map((post) => post.workoutTemplateId))
    ]);

    return rows.flatMap((post) => {
      const author = authors.get(post.authorId);
      if (!author) return [];
      return [this.assemble(post, author, workouts.get(post.workoutId ?? "") ?? null, templates.get(post.workoutTemplateId ?? "") ?? null, viewerId)];
    });
  }

  /** Single-row form, for the write paths where the row is already in hand. */
  async toResponse(post: Post, viewerId: string): Promise<PostResponseDto> {
    const [author, workouts, templates] = await Promise.all([
      this.userLoader.loadByIds([post.authorId]),
      this.loadWorkoutRefs([post.workoutId]),
      this.loadTemplateRefs([post.workoutTemplateId])
    ]);
    return this.assemble(
      post,
      author?.get(post.authorId) ?? this.fallbackAuthor(post),
      workouts.get(post.workoutId ?? "") ?? null,
      templates.get(post.workoutTemplateId ?? "") ?? null,
      viewerId
    );
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private assemble(post: Post, author: PostResponseDto["author"], workout: PostWorkoutRefDto | null, template: PostTemplateRefDto | null, viewerId: string): PostResponseDto {
    return {
      id: post.id,
      type: post.type,
      privacy: post.privacy,
      body: post.body,
      author,
      workout,
      workoutTemplate: template,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      // The viewer state a post response carries is only "did I write this".
      // The liked state is deliberately absent — see `PostViewerStateDto`.
      viewer: { isAuthor: post.authorId === viewerId },
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    };
  }

  /**
   * The minimal workout projection. A shared post renders a card, not a workout:
   * copying the full graph here would leak the owner's notes into every feed
   * read and would keep serving a workout the owner has since deleted.
   * `GET /workouts/:id` stays the authority for the full record.
   */
  private async loadWorkoutRefs(ids: (string | null)[]): Promise<Map<string, PostWorkoutRefDto>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.workoutsRepo.find({ where: { id: In(unique), isDeleted: false } });
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, startedAt: row.startedAt, durationSeconds: row.durationSeconds }]));
  }

  private async loadTemplateRefs(ids: (string | null)[]): Promise<Map<string, PostTemplateRefDto>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.templatesRepo.find({ where: { id: In(unique), isDeleted: false } });
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
  }

  /**
   * Only reachable when the author row vanished between the post read and the
   * hydration read. Keeps a create/update response renderable instead of
   * throwing, and still emits the same three fields as a hydrated author.
   */
  private fallbackAuthor(post: Post): PostResponseDto["author"] {
    return this.userPresenter.toSummary({
      id: post.authorId,
      name: post.author?.name ?? "Unknown",
      avatar: post.author?.avatar ?? null,
      googlePhotoUrl: post.author?.googlePhotoUrl ?? null
    });
  }
}
