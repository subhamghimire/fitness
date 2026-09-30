/**
 * FEED ENUMS AND PARAMETERS
 * ---------------------------------------------------------------------------
 * The feed's *vocabulary*: what a client can ask for, and what each option means
 * at the product level. The ranking *implementations* live in
 * `feed-ranking/`; nothing in this file knows how a ranking is computed.
 */

/**
 * The feed scopes — which set of posts a feed is built from.
 *
 *   FOLLOWING — only authors the viewer follows. The everyday feed. Includes
 *               the viewer's own posts, because "people I follow, and me" is
 *               what a user means by their feed, and excluding your own writing
 *               from your own timeline is a bug users notice immediately.
 *   DISCOVER  — every public post the viewer is allowed to see, regardless of
 *               following. This is the cold-start answer: a brand-new account
 *               follows nobody, and an empty feed is not an acceptable first
 *               session.
 *   LATEST    — the same candidate set as DISCOVER but with a different default
 *               ranking. It exists so "everything, newest first" is a named,
 *               cacheable thing rather than a strategy parameter on DISCOVER —
 *               two scopes that mean the same set but rank differently must not
 *               share a cache key.
 */
export enum FeedScope {
  FOLLOWING = "following",
  DISCOVER = "discover",
  LATEST = "latest"
}

/** Every feed scope a client may request, in the order the API documents them. */
export const FEED_SCOPES: readonly FeedScope[] = [FeedScope.FOLLOWING, FeedScope.DISCOVER, FeedScope.LATEST];

/** The default scope when a client does not ask for one. */
export const DEFAULT_FEED_SCOPE = FeedScope.FOLLOWING;
