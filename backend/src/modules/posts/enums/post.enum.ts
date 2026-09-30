/**
 * POST ENUMS
 * ---------------------------------------------------------------------------
 * The social platform's vocabulary. These three enums are deliberately small:
 * every value is either a rendering instruction ("show this reference inline") or
 * a visibility rule ("who may see it"). A social schema that grows taxonomy
 * faster than the product can enforce it is how moderation becomes impossible.
 */

/**
 * What a post *is*. Decides which reference column is populated and therefore
 * which of the type/reference consistency rules applies:
 *
 *   TEXT          — free text. `body` is required; no reference.
 *   WORKOUT_SHARE — a performed workout. `workoutId` is required.
 *   TEMPLATE_SHARE— a reusable template. `workoutTemplateId` is required.
 *   COACH_CONTENT — free text authored by a user with a coach profile. `body` is
 *                   required, and the author must actually be a coach, so the
 *                   type cannot be used to impersonate one.
 *
 * `type` and the reference columns are immutable after creation. A post that
 * could be retyped would need every consistency rule re-validated on every
 * update, and would make `uk_posts_author_workout` (one workout share per author)
 * meaningless.
 */
export enum PostType {
  TEXT = "text",
  WORKOUT_SHARE = "workout_share",
  TEMPLATE_SHARE = "template_share",
  COACH_CONTENT = "coach_content"
}

/**
 * Who may see a post. Three levels, no "close friends" tier and no per-post
 * allow-list — every additional tier is a rule that has to be enforced in the
 * feed query, the point read, the like check, the comment check and the report
 * check, and each one is a chance to leak.
 *
 *   PUBLIC     — anyone who is not blocked by the author.
 *   FOLLOWERS  — only accounts the author follows' *readers*: the viewer must
 *                have a live follow edge to the author.
 *   PRIVATE    — the author only. Still reportable-by-necessity: a private post
 *                is unreachable, so the moderation path is reports on the user.
 */
export enum PostPrivacy {
  PUBLIC = "public",
  FOLLOWERS = "followers",
  PRIVATE = "private"
}

/** Post types that reference a workout session rather than a template. */
export const WORKOUT_SHARE_TYPES: readonly PostType[] = [PostType.WORKOUT_SHARE];

/** Post types that carry a required, non-empty body. */
export const BODY_REQUIRED_TYPES: readonly PostType[] = [PostType.TEXT, PostType.COACH_CONTENT];
