/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from "@nestjs/common";

import { at, buildSocialTestModule, http, insertFollow, insertPost, resetSocialHarness, USER_ALICE, USER_BOB, USER_CAROL, USER_DAVE } from "./social-harness";

/**
 * SOCIAL FEED — SCOPES, RANKINGS, PAGINATION, CACHE
 * ---------------------------------------------------------------------------
 * The read side of the platform, end to end over HTTP against the real
 * `FeedService`, the real ranking strategies, the real visibility rule and the
 * real cursor codec, with only Postgres and Redis stood in for (see
 * `social-harness.ts`).
 *
 * The write side (posts, follows, blocks, likes, comments, reports) is in
 * `social-platform.e2e-spec.ts`; this file assumes those rows and asserts what
 * a feed *shows*.
 */
describe("Social feed (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await buildSocialTestModule();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetSocialHarness();
  });

  const asUser = (userId: string) => ({ "x-test-user-id": userId });
  const feed = (userId: string, query: Record<string, string> = {}) => http(app).get("/api/v1/social/feed").query(query).set(asUser(userId));
  const bodies = (response: { body: { data: { body: string }[] } }): string[] => response.body.data.map((post) => post.body);

  /* ───────────────────────── scopes ─────────────────────────────────────── */

  describe("scopes", () => {
    beforeEach(() => {
      insertPost({ authorId: USER_ALICE, body: "alice public", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_BOB, body: "bob public", privacy: "public", createdAt: at(1) });
      insertPost({ authorId: USER_CAROL, body: "carol public", privacy: "public", createdAt: at(2) });
    });

    it("defaults to the following scope, which is followed authors plus your own posts", async () => {
      insertFollow(USER_ALICE, USER_BOB);

      // No `scope` param: the everyday feed. Carol is not followed, so she is
      // not a candidate even though her post is public.
      const response = await feed(USER_ALICE).expect(200);
      expect(response.body.scope).toBe("following");
      expect(response.body.strategy).toBe("recent");
      expect(bodies(response)).toEqual(["bob public", "alice public"]);
    });

    it("shows a brand-new account its own posts rather than an empty screen", async () => {
      // Dave follows nobody. His own post keeps the feed non-empty, which is
      // both what "my feed" means and what stops a cold start from looking
      // broken.
      insertPost({ authorId: USER_DAVE, body: "dave first", privacy: "public", createdAt: at(3) });

      const response = await feed(USER_DAVE, { scope: "following" }).expect(200);
      expect(bodies(response)).toEqual(["dave first"]);
    });

    it("reads discover as every visible public post, regardless of the graph", async () => {
      const response = await feed(USER_DAVE, { scope: "discover" }).expect(200);
      expect(bodies(response)).toEqual(["carol public", "bob public", "alice public"]);
    });

    it("treats latest as the same candidate set as discover under the recent ranking", async () => {
      const discover = await feed(USER_DAVE, { scope: "discover" }).expect(200);
      const latest = await feed(USER_DAVE, { scope: "latest" }).expect(200);
      expect(bodies(latest)).toEqual(bodies(discover));
    });

    it("rejects an unknown scope at the edge", async () => {
      await feed(USER_ALICE, { scope: "everyone" }).expect(400);
    });
  });

  /* ─────────────── visibility inside the feed ───────────────────────────── */

  describe("visibility", () => {
    beforeEach(() => {
      insertPost({ authorId: USER_ALICE, body: "public", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_ALICE, body: "followers only", privacy: "followers", createdAt: at(1) });
      insertPost({ authorId: USER_ALICE, body: "private", privacy: "private", createdAt: at(2) });
    });

    it("never surfaces private posts to anyone but the author, in any scope", async () => {
      insertFollow(USER_CAROL, USER_ALICE);

      const following = await feed(USER_CAROL, { scope: "following" }).expect(200);
      expect(bodies(following)).toEqual(["followers only", "public"]);

      const discover = await feed(USER_CAROL, { scope: "discover" }).expect(200);
      expect(bodies(discover)).toEqual(["followers only", "public"]);

      const own = await feed(USER_ALICE, { scope: "following" }).expect(200);
      expect(bodies(own)).toEqual(["private", "followers only", "public"]);
    });

    it("hides followers-only posts from strangers, in every scope", async () => {
      // Carol follows nobody, so the following scope is just her own (empty)
      // timeline — a stranger cannot pull a followers-only post through it.
      const following = await feed(USER_CAROL, { scope: "following" }).expect(200);
      expect(bodies(following)).toEqual([]);

      const discover = await feed(USER_CAROL, { scope: "discover" }).expect(200);
      expect(bodies(discover)).toEqual(["public"]);
    });

    it("applies a block in both directions, including to public posts", async () => {
      insertPost({ authorId: USER_BOB, body: "bob public", privacy: "public", createdAt: at(3) });
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(201);

      // Alice no longer sees Bob; Bob still sees his own post (rule 1 of the
      // visibility service) but nothing of Alice's.
      expect(bodies(await feed(USER_ALICE, { scope: "discover" }).expect(200))).toEqual(["private", "followers only", "public"]);
      expect(bodies(await feed(USER_BOB, { scope: "discover" }).expect(200))).toEqual(["bob public"]);
    });
  });

  /* ─────────────── pagination ───────────────────────────────────────────── */

  describe("pagination", () => {
    it("pages newest-first without dropping or repeating a post", async () => {
      const authors = [USER_ALICE, USER_BOB, USER_CAROL, USER_DAVE];
      for (let index = 0; index < 6; index++) insertPost({ authorId: authors[index % authors.length], body: `p${index}`, privacy: "public", createdAt: at(Math.floor(index / 2)) });

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: Record<string, string> = { scope: "discover", limit: "2" };
        if (cursor) query.cursor = cursor;
        const response = await feed(USER_DAVE, query).expect(200);
        seen.push(...bodies(response));
        cursor = response.body.meta.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
      expect(seen.slice(0, 2).sort()).toEqual(["p4", "p5"]);
    });

    it("stops with a null cursor and `hasMore: false` on the last page", async () => {
      insertPost({ authorId: USER_ALICE, body: "only", privacy: "public" });
      const response = await feed(USER_BOB, { scope: "discover" }).expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({ nextCursor: null, hasMore: false });
    });

    it("rejects a cursor minted for another scope/strategy pair", async () => {
      insertPost({ authorId: USER_ALICE, body: "a", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_BOB, body: "b", privacy: "public", createdAt: at(1) });

      const page = await feed(USER_CAROL, { scope: "discover", limit: "1" }).expect(200);
      expect(page.body.meta.nextCursor).not.toBeNull();

      // Same rows, different scope name in the cursor: restart, not a scramble.
      await feed(USER_CAROL, { scope: "following", limit: "1", cursor: page.body.meta.nextCursor }).expect(400);
      // Same scope, different ranking: also restart.
      await feed(USER_CAROL, { scope: "discover", strategy: "hot", limit: "1", cursor: page.body.meta.nextCursor }).expect(400);
    });

    it("rejects an unknown strategy with the valid set in the message", async () => {
      const response = await feed(USER_ALICE, { strategy: "nope" }).expect(400);
      expect(String(response.body.message)).toContain("recent");
      expect(String(response.body.message)).toContain("hot");
    });
  });

  /* ─────────────── rankings ─────────────────────────────────────────────── */

  describe("rankings", () => {
    it("orders the recent strategy strictly newest-first", async () => {
      insertPost({ authorId: USER_ALICE, body: "old", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_BOB, body: "new", privacy: "public", createdAt: at(5) });

      const response = await feed(USER_CAROL, { scope: "discover", strategy: "recent" }).expect(200);
      expect(response.body.strategy).toBe("recent");
      expect(bodies(response)).toEqual(["new", "old"]);
    });

    it("lets engagement outrank recency under the hot strategy", async () => {
      // Same age, very different engagement: the hot score must follow the
      // counters, not the clock. Counters are arranged directly because the
      // ranking reads the denormalised columns, not the like rows.
      insertPost({ authorId: USER_ALICE, body: "quiet and new", privacy: "public", createdAt: at(10), likeCount: 0, commentCount: 0 });
      insertPost({ authorId: USER_BOB, body: "loud and old", privacy: "public", createdAt: at(0), likeCount: 40, commentCount: 10 });

      const hot = await feed(USER_CAROL, { scope: "discover", strategy: "hot" }).expect(200);
      expect(bodies(hot)).toEqual(["loud and old", "quiet and new"]);

      // And recent still disagrees: the two strategies are genuinely different
      // orderings over the same candidates.
      const recent = await feed(USER_CAROL, { scope: "discover", strategy: "recent" }).expect(200);
      expect(bodies(recent)).toEqual(["quiet and new", "loud and old"]);
    });

    it("pages the hot strategy without losing a post at the boundary", async () => {
      insertPost({ authorId: USER_ALICE, body: "h0", privacy: "public", createdAt: at(0), likeCount: 30, commentCount: 0 });
      insertPost({ authorId: USER_BOB, body: "h1", privacy: "public", createdAt: at(1), likeCount: 20, commentCount: 0 });
      insertPost({ authorId: USER_CAROL, body: "h2", privacy: "public", createdAt: at(2), likeCount: 10, commentCount: 0 });

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: Record<string, string> = { scope: "discover", strategy: "hot", limit: "2" };
        if (cursor) query.cursor = cursor;
        const response = await feed(USER_DAVE, query).expect(200);
        seen.push(...bodies(response));
        cursor = response.body.meta.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      expect(seen).toEqual(["h0", "h1", "h2"]);
    });

    it("lists the available strategies for discovery", async () => {
      const response = await http(app).get("/api/v1/social/feed/strategies").set(asUser(USER_ALICE)).expect(200);
      expect(response.body.map((strategy: { id: string }) => strategy.id).sort()).toEqual(["hot", "recent"]);
    });
  });

  /* ─────────────── first-page cache ─────────────────────────────────────── */

  describe("first-page cache", () => {
    it("serves a repeat first-page read consistently", async () => {
      insertPost({ authorId: USER_ALICE, body: "a", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_BOB, body: "b", privacy: "public", createdAt: at(1) });
      insertFollow(USER_CAROL, USER_ALICE);
      insertFollow(USER_CAROL, USER_BOB);

      const first = await feed(USER_CAROL, { scope: "following" }).expect(200);
      const second = await feed(USER_CAROL, { scope: "following" }).expect(200);
      expect(bodies(second)).toEqual(bodies(first));
    });

    it("hides a blocked author's posts immediately, even on a cached first page", async () => {
      insertPost({ authorId: USER_ALICE, body: "a", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_BOB, body: "b", privacy: "public", createdAt: at(1) });
      insertFollow(USER_CAROL, USER_ALICE);
      insertFollow(USER_CAROL, USER_BOB);

      // Prime the first-page cache.
      expect(bodies(await feed(USER_CAROL, { scope: "following" }).expect(200))).toEqual(["b", "a"]);

      // The cached page is ids only; rows are re-read and re-filtered, so the
      // block is effective on the very next read rather than after the TTL.
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_CAROL)).send({}).expect(201);
      expect(bodies(await feed(USER_CAROL, { scope: "following" }).expect(200))).toEqual(["a"]);
    });
  });

  /* ─────────────── filters ──────────────────────────────────────────────── */

  describe("filters", () => {
    it("restricts to one post type without widening visibility", async () => {
      const shared = await http(app).post("/api/v1/social/posts").set(asUser(USER_ALICE)).send({ type: "text", body: "hello" }).expect(201);
      expect(shared.body.type).toBe("text");

      const response = await feed(USER_BOB, { scope: "discover", type: "text" }).expect(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      for (const post of response.body.data) expect(post.type).toBe("text");
    });
  });
});
