/**
 * COMMENTS ENUMS
 * ---------------------------------------------------------------------------
 * Comments support exactly one level of nesting, and the enum that says so is
 * the product decision, not an implementation detail — see the note on
 * `COMMENT_MAX_DEPTH`.
 */

/**
 * Threading depth.
 *
 * `0` — a top-level comment on a post.
 * `1` — a reply to a top-level comment.
 *
 * There is no deeper level, and the limit is a *feature* rather than a
 * simplification. A fully nested tree has to answer hard questions on every
 * read: what happens to a subtree whose parent is deleted, how a page of
 * top-level comments paginates when their replies change underneath it, and what
 * "50 comments" even means. One level answers all of those trivially, and a
 * reply-to-reply is expressed as a new top-level comment quoting its context.
 *
 * If product later needs real threads, the column shape does not change —
 * `parent_id` is already a self-reference — only this enum and the read
 * strategy do.
 */
export const COMMENT_MAX_DEPTH = 1;

/** Whether a comment sits at the top of a thread or replies to one. */
export type CommentDepth = 0 | 1;
