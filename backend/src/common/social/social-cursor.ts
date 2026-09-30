import { BadRequestException } from "@nestjs/common";

/**
 * OPAQUE CURSOR PAGINATION
 * ---------------------------------------------------------------------------
 * Every social list — a profile's posts, a post's comments, a follower list, the
 * feed — is paginated with an opaque keyset cursor rather than `page`/`offset`.
 *
 * Why keyset, and why opaque:
 *
 *   - OFFSET skips or repeats rows whenever the underlying ordering key moves
 *     between requests. A feed is *constantly* receiving new posts, so
 *     `?page=2` is not a stable description of "the next 20 posts" — the
 *     client sees duplicates and gaps. A keyset cursor names the last row it
 *     received and asks for rows strictly after it.
 *   - A cursor that is a readable JSON blob invites clients to construct and
 *     tamper with it. The payload is base64url of a *versioned* document, and
 *     decoding is total: a client that sends something we did not mint gets a
 *     400 telling it to restart pagination, never a silently wrong page.
 *   - The version is what makes ranking evolvable. When the ordering keys
 *     change (a new ranking strategy, a new tiebreaker), previously issued
 *     cursors are rejected instead of being interpreted against an ordering
 *     they were not minted for. That is the whole contract that lets the feed
 *     ranker change without corrupting in-flight pagination.
 */
export const SOCIAL_CURSOR_VERSION = 1;

export interface SocialCursor {
  /** Schema version of the cursor document itself. */
  v: number;
  /** Name of the ordering strategy that produced the page. */
  s: string;
  /**
   * Sort-key values, in the *strategy's* key order, all stringified.
   *
   * Strings because sort keys are heterogeneous: a timestamp, a uuid, an
   * integer counter. They are compared by the same comparator the database
   * uses, so the cursor is a faithful description of the boundary row rather
   * than an approximation of it.
   */
  k: string[];
}

/** A page of results plus the cursor that continues it. */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeSocialCursor(cursor: SocialCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSocialCursor(raw: string, expectedStrategy: string): SocialCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("Malformed cursor");
  }

  if (typeof parsed !== "object" || parsed === null) throw new BadRequestException("Malformed cursor");

  const candidate = parsed as Partial<SocialCursor>;
  if (candidate.v !== SOCIAL_CURSOR_VERSION) throw new BadRequestException("Unsupported cursor version; restart pagination");
  if (candidate.s !== expectedStrategy) throw new BadRequestException("Cursor was issued for a different ordering; restart pagination");
  if (!Array.isArray(candidate.k) || candidate.k.some((value) => typeof value !== "string")) throw new BadRequestException("Malformed cursor");

  return { v: candidate.v, s: candidate.s, k: candidate.k };
}

/**
 * Builds the page envelope from an over-fetched result set.
 *
 * Callers fetch `limit + 1` rows: the extra row is the *only* honest signal
 * that another page exists, and it is discarded here rather than returned.
 * `hasMore` therefore never disagrees with the data the client is holding.
 */
export function toCursorPage<T>(rows: T[], limit: number, cursorFor: (row: T) => string | null): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last !== undefined ? cursorFor(last) : null, hasMore };
}
