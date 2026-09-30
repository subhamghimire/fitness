/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { PostEngagementService } from "src/modules/posts/post-engagement.service";
import { PostType } from "src/modules/posts/enums";
import { CommentsService } from "src/modules/comments/comments.service";
import { ReportsService } from "src/modules/reports/reports.service";
import { ReportStatus, ReportTargetType, ReportReason } from "src/modules/reports/enums";

import {
  at,
  buildSocialTestModule,
  http,
  insertFollow,
  insertPost,
  recordedEvents,
  resetSocialHarness,
  socialTables,
  TEMPLATE_ALICE,
  USER_ALICE,
  USER_BOB,
  USER_CAROL,
  USER_COACH,
  USER_DAVE,
  WORKOUT_ALICE,
  WORKOUT_BOB,
  WORKOUT_STRANGER
} from "./social-harness";

/**
 * SOCIAL PLATFORM — POSTS, FOLLOWS, BLOCKS, LIKES, COMMENTS, REPORTS
 * ---------------------------------------------------------------------------
 * The write-and-read side of the platform, end to end over HTTP against the real
 * services, the real DTO validation, the real visibility rule and the real cursor
 * codec, with only Postgres and Redis stood in for (see `social-harness.ts` for
 * why, and for what the fake deliberately does *not* fake).
 *
 * The feed and the ranking strategies are in `social-feed.e2e-spec.ts`; this file
 * is about the five modules that own rows.
 */
describe("Social platform (e2e)", () => {
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
  const posts = (userId: string) => http(app).get("/api/v1/social/posts").set(asUser(userId));
  const postById = (userId: string, id: string) => http(app).get(`/api/v1/social/posts/${id}`).set(asUser(userId));
  const createPost = (userId: string, body: Record<string, unknown>) => http(app).post("/api/v1/social/posts").set(asUser(userId)).send(body);
  const like = (userId: string, postId: string) => http(app).post(`/api/v1/social/posts/${postId}/like`).set(asUser(userId));
  const unlike = (userId: string, postId: string) => http(app).delete(`/api/v1/social/posts/${postId}/like`).set(asUser(userId));
  const comment = (userId: string, postId: string, body: Record<string, unknown>) => http(app).post(`/api/v1/social/posts/${postId}/comments`).set(asUser(userId)).send(body);
  const comments = (userId: string, postId: string, query: Record<string, string> = {}) => http(app).get(`/api/v1/social/posts/${postId}/comments`).query(query).set(asUser(userId));
  const follow = (userId: string, targetId: string) => http(app).post(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));
  const unfollow = (userId: string, targetId: string) => http(app).delete(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));
  const followState = (userId: string, targetId: string) => http(app).get(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));
  const block = (userId: string, targetId: string, body: Record<string, unknown> = {}) => http(app).post(`/api/v1/social/users/${targetId}/block`).set(asUser(userId)).send(body);

  const livePosts = (): unknown[] => socialTables().posts.filter((post) => post.isDeleted !== true);

  /* ───────────────────────────── posts: writes ───────────────────────────── */

  describe("posts — creation", () => {
    it("creates a text post, trims the body, and stamps the viewer state", async () => {
      const response = await createPost(USER_ALICE, { type: PostType.TEXT, body: "  Squat day  " }).expect(201);

      expect(response.body.body).toBe("Squat day");
      expect(response.body.type).toBe("text");
      expect(response.body.privacy).toBe("public");
      expect(response.body.likeCount).toBe(0);
      expect(response.body.commentCount).toBe(0);
      expect(response.body.viewer).toEqual({ isAuthor: true });
      // The only user shape a social payload may carry. `email` is absent by
      // construction — SocialUserPresenter copies named fields.
      expect(response.body.author).toEqual({ id: USER_ALICE, name: "Alice", avatarUrl: "https://cdn.test/alice.png" });
      expect(response.body.author.email).toBeUndefined();
    });

    it("prefers an uploaded avatar over a Google one and builds it from APP_URL", async () => {
      await insertPost({ authorId: USER_ALICE, body: "a" });
      await insertPost({ authorId: USER_BOB, body: "b" });

      const response = await posts(USER_ALICE).expect(200);
      const bob = response.body.data.find((post: { author: { id: string } }) => post.author.id === USER_BOB);
      expect(bob.author.avatarUrl).toBe("https://app.test/avatars/bob.png");
    });

    it("refuses a workout share the author does not own, and one that does not exist", async () => {
      // The privacy hole a reference-based share would otherwise open: Bob's
      // workout re-published through a channel Bob cannot audit.
      await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_BOB }).expect(403);
      await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_STRANGER }).expect(403);
      await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: "40000000-0000-4000-8000-999999999999" }).expect(404);
      expect(livePosts()).toHaveLength(0);
    });

    it("allows a share of your own workout exactly once while the post is live", async () => {
      const first = await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE, body: "leg day" }).expect(201);
      expect(first.body.workout).toEqual({ id: WORKOUT_ALICE, name: "Alice leg day", startedAt: WORKOUT_UNUSED_START, durationSeconds: 3600 });

      // `uk_posts_author_workout` is the guarantee; the read above is only a
      // friendlier message for the sequential case.
      await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE }).expect(409);
      expect(livePosts()).toHaveLength(1);
    });

    it("lets an author re-share a workout after the first post is deleted", async () => {
      const first = await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE }).expect(201);

      await http(app).delete(`/api/v1/social/posts/${first.body.id}`).set(asUser(USER_ALICE)).expect(200);
      // The index is partial (`WHERE isDeleted = false`), so a soft delete really
      // does free the pair rather than permanently occupying it.
      await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE }).expect(201);
    });

    it("shares a template only when you own it", async () => {
      await createPost(USER_ALICE, { type: PostType.TEMPLATE_SHARE, workoutTemplateId: TEMPLATE_ALICE }).expect(201);
      await createPost(USER_BOB, { type: PostType.TEMPLATE_SHARE, workoutTemplateId: TEMPLATE_ALICE }).expect(403);
    });

    it("treats COACH_CONTENT as a claim about the author, not a cosmetic type", async () => {
      await createPost(USER_ALICE, { type: PostType.COACH_CONTENT, body: "Do this instead" }).expect(403);
      await createPost(USER_COACH, { type: PostType.COACH_CONTENT, body: "Do this instead" }).expect(201);
    });

    it("refuses a text post with no body, including one that is only whitespace", async () => {
      await createPost(USER_ALICE, { type: PostType.TEXT }).expect(400);
      await createPost(USER_ALICE, { type: PostType.TEXT, body: "   " }).expect(400);
      expect(livePosts()).toHaveLength(0);
    });

    it("rejects a body over the documented content limit", async () => {
      await createPost(USER_ALICE, { type: PostType.TEXT, body: "x".repeat(2201) }).expect(400);
      await createPost(USER_ALICE, { type: PostType.TEXT, body: "x".repeat(2200) }).expect(201);
    });
  });

  /* ────────────────────────── posts: edit & delete ──────────────────────── */

  describe("posts — edit and delete", () => {
    it("lets the author edit the body and privacy, and nobody else", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "first" }).expect(201);

      // 404 rather than 403: a 403 confirms the id exists, and the post id space
      // is not something an outsider should be able to probe.
      await http(app).patch(`/api/v1/social/posts/${created.body.id}`).set(asUser(USER_BOB)).send({ body: "hijacked" }).expect(404);

      const edited = await http(app)
        .patch(`/api/v1/social/posts/${created.body.id}`)
        .set(asUser(USER_ALICE))
        .send({ body: "second", privacy: "followers" })
        .expect(200);
      expect(edited.body.body).toBe("second");
      expect(edited.body.privacy).toBe("followers");
    });

    it("ignores `type` and `workoutId` on an edit, because they are immutable", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "first" }).expect(201);

      const edited = await http(app)
        .patch(`/api/v1/social/posts/${created.body.id}`)
        .set(asUser(USER_ALICE))
        .send({ body: "second", type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE })
        .expect(200);

      expect(edited.body.type).toBe(PostType.TEXT);
      expect(edited.body.workout).toBeNull();
      const stored = socialTables().posts[0];
      expect(stored.workoutId).toBeNull();
    });

    it("refuses to empty a text post, but allows clearing a share caption", async () => {
      const text = await createPost(USER_ALICE, { type: PostType.TEXT, body: "something" }).expect(201);
      await http(app).patch(`/api/v1/social/posts/${text.body.id}`).set(asUser(USER_ALICE)).send({ body: "   " }).expect(400);

      const share = await createPost(USER_ALICE, { type: PostType.WORKOUT_SHARE, workoutId: WORKOUT_ALICE, body: "caption" }).expect(201);
      const cleared = await http(app).patch(`/api/v1/social/posts/${share.body.id}`).set(asUser(USER_ALICE)).send({ body: "" }).expect(200);
      expect(cleared.body.body).toBeNull();
    });

    it("soft-deletes idempotently, keeps the row, and shows the author a tombstone but a stranger nothing", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "regrettable" }).expect(201);

      await http(app).delete(`/api/v1/social/posts/${created.body.id}`).set(asUser(USER_ALICE)).expect(200);
      await http(app).delete(`/api/v1/social/posts/${created.body.id}`).set(asUser(USER_ALICE)).expect(200);

      // The row survives so an open thread does not collapse and a report stays
      // resolvable.
      expect(socialTables().posts).toHaveLength(1);
      expect(socialTables().posts[0].isDeleted).toBe(true);
      expect(socialTables().posts[0].deletedBy).toBe(USER_ALICE);

      // The author still sees it; the list read hides deleted rows even from
      // their own author, because a tombstone in a list is noise, not history.
      await postById(USER_ALICE, created.body.id).expect(200);
      await postById(USER_BOB, created.body.id).expect(404);
      const listed = await posts(USER_ALICE).expect(200);
      expect(listed.body.data).toHaveLength(0);
    });

    it("refuses to delete somebody else's post", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "mine" }).expect(201);
      await http(app).delete(`/api/v1/social/posts/${created.body.id}`).set(asUser(USER_BOB)).expect(404);
      expect(socialTables().posts[0].isDeleted).toBe(false);
    });
  });

  /* ───────────────────────── posts: visibility ──────────────────────────── */

  describe("posts — visibility", () => {
    beforeEach(() => {
      insertPost({ authorId: USER_ALICE, body: "public", privacy: "public", createdAt: at(0) });
      insertPost({ authorId: USER_ALICE, body: "followers only", privacy: "followers", createdAt: at(1) });
      insertPost({ authorId: USER_ALICE, body: "private", privacy: "private", createdAt: at(2) });
      insertPost({ authorId: USER_BOB, body: "bob public", privacy: "public", createdAt: at(3) });
    });

    const visibleBodies = async (userId: string): Promise<string[]> => {
      const response = await posts(userId).expect(200);
      return response.body.data.map((post: { body: string }) => post.body);
    };

    it("shows a stranger only the PUBLIC tier", async () => {
      expect(await visibleBodies(USER_CAROL)).toEqual(["bob public", "public"]);
    });

    it("opens the FOLLOWERS tier to a live follow edge and never to a stranger", async () => {
      expect(await visibleBodies(USER_CAROL)).not.toContain("followers only");
      insertFollow(USER_CAROL, USER_ALICE);
      expect(await visibleBodies(USER_CAROL)).toEqual(["bob public", "followers only", "public"]);
    });

    it("never opens the PRIVATE tier, not even to a follower", async () => {
      insertFollow(USER_CAROL, USER_ALICE);
      expect(await visibleBodies(USER_CAROL)).not.toContain("private");
    });

    it("lets the author see their own private post", async () => {
      const own = await visibleBodies(USER_ALICE);
      // Global timeline: Alice's own three plus Bob's public post, newest first.
      expect(own).toEqual(["bob public", "private", "followers only", "public"]);
    });

    it("404s a point read of a post the caller cannot see, for every non-public tier", async () => {
      const followersPost = socialTables().posts.find((post) => post.privacy === "followers");
      const privatePost = socialTables().posts.find((post) => post.privacy === "private");

      await postById(USER_CAROL, String(followersPost?.id)).expect(404);
      await postById(USER_CAROL, String(privatePost?.id)).expect(404);
      // A 403 would confirm the id exists, which is the oracle this avoids.
      await postById(USER_CAROL, String(followersPost?.id)).expect((response) => {
        expect(response.body.message).toBe("Post not found");
      });
      await postById(USER_CAROL, "40000000-0000-4000-8000-999999999999").expect(404);
    });

    it("applies a block in both directions, including to PUBLIC posts", async () => {
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(201);

      expect(await visibleBodies(USER_ALICE)).toEqual(["private", "followers only", "public"]);
      // Bob still sees his own post: rule (1) of the visibility service says
      // your own posts are always visible to you, even across a block.
      expect(await visibleBodies(USER_BOB)).toEqual(["bob public"]);
    });
  });

  /* ─────────────────────── posts: profile list & cursor ─────────────────── */

  describe("posts — profile list and cursor", () => {
    it("pages a profile newest-first without dropping or repeating a post", async () => {
      // Six posts, two pairs sharing a `createdAt`: the `id` tiebreaker is the
      // only thing keeping the ordering total, and a page boundary landing inside
      // a tie is exactly when an id-less keyset loses a row forever.
      const authors = [USER_ALICE, USER_BOB, USER_CAROL, USER_DAVE];
      for (let index = 0; index < 6; index++) insertPost({ authorId: authors[index % authors.length], body: `p${index}`, createdAt: at(Math.floor(index / 2)) });

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: Record<string, string> = { limit: "2" };
        if (cursor) query.cursor = cursor;
        const response = await http(app).get("/api/v1/social/posts").query(query).set(asUser(USER_DAVE)).expect(200);
        seen.push(...response.body.data.map((post: { body: string }) => post.body));
        cursor = response.body.meta.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
      // Newest first, so the last-written pair leads.
      expect(seen.slice(0, 2).sort()).toEqual(["p4", "p5"]);
      expect(seen[seen.length - 1]).toBe("p0");
    });

    it("stops with a null cursor and `hasMore: false` on the last page", async () => {
      insertPost({ authorId: USER_ALICE, body: "only" });
      const response = await posts(USER_BOB).expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({ nextCursor: null, hasMore: false });
    });

    it("rejects a limit above the documented maximum", async () => {
      await posts(USER_BOB).query({ limit: "51" }).expect(400);
    });

    it("404s a profile listing for a user that does not exist", async () => {
      await http(app).get(`/api/v1/social/users/40000000-0000-4000-8000-999999999999/posts`).set(asUser(USER_ALICE)).expect(404);
    });

    it("applies the same visibility rule to one author's list as to the global one", async () => {
      insertPost({ authorId: USER_ALICE, body: "public", privacy: "public" });
      insertPost({ authorId: USER_ALICE, body: "private", privacy: "private" });

      const asOwner = await http(app).get(`/api/v1/social/users/${USER_ALICE}/posts`).set(asUser(USER_ALICE)).expect(200);
      expect(asOwner.body.data).toHaveLength(2);

      const asStranger = await http(app).get(`/api/v1/social/users/${USER_ALICE}/posts`).set(asUser(USER_BOB)).expect(200);
      expect(asStranger.body.data.map((post: { body: string }) => post.body)).toEqual(["public"]);
    });
  });

  /* ────────────────────────────── follows ───────────────────────────────── */

  describe("follows", () => {
    const follow = (userId: string, targetId: string) => http(app).post(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));
    const unfollow = (userId: string, targetId: string) => http(app).delete(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));
    const state = (userId: string, targetId: string) => http(app).get(`/api/v1/social/users/${targetId}/follow`).set(asUser(userId));

    it("follows, refuses a duplicate with 409, and reports the relationship in one call", async () => {
      const followed = await follow(USER_ALICE, USER_BOB).expect(201);
      expect(followed.body.isFollowing).toBe(true);
      expect(followed.body.followerCount).toBe(1);
      expect(followed.body.user).toEqual({ id: USER_BOB, name: "Bob", avatarUrl: "https://app.test/avatars/bob.png" });

      // "I just followed you" and "you already follow this" are different facts.
      await follow(USER_ALICE, USER_BOB).expect(409);
      expect(socialTables().follows).toHaveLength(1);

      const mutual = await follow(USER_BOB, USER_ALICE).expect(201);
      expect(mutual.body.isFollowedBy).toBe(true);
      expect(mutual.body.followerCount).toBe(1);
      expect(mutual.body.followingCount).toBe(1);
    });

    it("refuses a self-follow and a self-state query", async () => {
      await follow(USER_ALICE, USER_ALICE).expect(400);
      await unfollow(USER_ALICE, USER_ALICE).expect(400);
      await state(USER_ALICE, USER_ALICE).expect(400);
    });

    it("404s a follow of a user that does not exist", async () => {
      await follow(USER_ALICE, "40000000-0000-4000-8000-999999999999").expect(404);
    });

    it("unfollows idempotently, and a re-follow is a new edge rather than a revival", async () => {
      await follow(USER_ALICE, USER_BOB).expect(201);

      const after = await unfollow(USER_ALICE, USER_BOB).expect(200);
      expect(after.body.isFollowing).toBe(false);
      // A repeat is the normal shape of an optimistic client, so it is not an error.
      await unfollow(USER_ALICE, USER_BOB).expect(200);

      await follow(USER_ALICE, USER_BOB).expect(201);
      const live = socialTables().follows.filter((edge) => edge.isDeleted !== true);
      expect(live).toHaveLength(1);
      // The record of the first edge is kept, which is what lets a re-follow be
      // distinguished from a first follow.
      expect(socialTables().follows).toHaveLength(2);
      expect(socialTables().follows[0].isDeleted).toBe(true);
    });

    it("refuses a follow when the pair is blocked in either direction", async () => {
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(201);

      await follow(USER_BOB, USER_ALICE).expect(409);
      await follow(USER_ALICE, USER_BOB).expect(409);
    });

    it("announces a new follower to the followee only", async () => {
      await follow(USER_ALICE, USER_BOB).expect(201);

      const events = recordedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("new_follower");
      expect(events[0].audience).toEqual({ kind: "users", userIds: [USER_BOB], excludeActor: true });
      expect(events[0].payload).toEqual({ followerId: USER_ALICE, followerName: "Alice" });
    });

    it("pages follower and following lists, excluding soft-deleted edges", async () => {
      await follow(USER_ALICE, USER_BOB).expect(201);
      await follow(USER_CAROL, USER_ALICE).expect(201);
      await follow(USER_DAVE, USER_ALICE).expect(201);
      // A third follower so a limit-2 first page genuinely has more: Alice's
      // followers are Bob, Carol and Dave, newest first.
      await follow(USER_BOB, USER_ALICE).expect(201);

      const followers = await http(app).get(`/api/v1/social/users/${USER_ALICE}/followers`).query({ limit: "2" }).set(asUser(USER_BOB)).expect(200);
      expect(followers.body.data).toHaveLength(2);
      expect(followers.body.meta.hasMore).toBe(true);
      expect(followers.body.data[0].followedAt).toBeDefined();

      const second = await http(app)
        .get(`/api/v1/social/users/${USER_ALICE}/followers`)
        .query({ limit: "2", cursor: followers.body.meta.nextCursor })
        .set(asUser(USER_BOB))
        .expect(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.meta).toMatchObject({ hasMore: false, nextCursor: null });

      const following = await http(app).get(`/api/v1/social/users/${USER_ALICE}/following`).set(asUser(USER_BOB)).expect(200);
      expect(following.body.data.map((row: { id: string }) => row.id)).toEqual([USER_BOB]);
    });

    it("rejects a cursor minted for another list", async () => {
      insertFollow(USER_CAROL, USER_ALICE);
      insertFollow(USER_DAVE, USER_ALICE);
      const page = await http(app).get(`/api/v1/social/users/${USER_ALICE}/followers`).query({ limit: "1" }).set(asUser(USER_BOB)).expect(200);

      // Same strategy name, so this is accepted; the *posts* cursor is the one
      // that must be refused, and it is refused on strategy mismatch.
      const postsPage = await posts(USER_BOB).expect(200);
      expect(postsPage.body.meta.nextCursor).toBeNull();
      await http(app)
        .get(`/api/v1/social/users/${USER_ALICE}/followers`)
        .query({ cursor: "not-a-cursor" })
        .set(asUser(USER_BOB))
        .expect(400);
    });
  });

  /* ─────────────────────────────── blocks ───────────────────────────────── */

  describe("blocks", () => {
    it("severs follow edges in both directions and refuses a second block", async () => {
      await http(app).post(`/api/v1/social/users/${USER_ALICE}/follow`).set(asUser(USER_BOB)).expect(201);
      await http(app).post(`/api/v1/social/users/${USER_BOB}/follow`).set(asUser(USER_ALICE)).expect(201);

      const blocked = await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({ reason: "harassment" }).expect(201);
      expect(blocked.body.reason).toBe("harassment");
      expect(blocked.body.avatarUrl).toBe("https://app.test/avatars/bob.png");

      // The destructive half is the point: a surviving edge would keep the pair
      // inside each other's cached follow graph and keep counts inflated.
      expect(socialTables().follows.filter((edge) => edge.isDeleted !== true)).toHaveLength(0);
      expect(socialTables().follows).toHaveLength(2);

      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(409);
    });

    it("unblocks idempotently without restoring the follow edges", async () => {
      await http(app).post(`/api/v1/social/users/${USER_ALICE}/follow`).set(asUser(USER_BOB)).expect(201);
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(201);

      await http(app).delete(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).expect(200);
      await http(app).delete(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).expect(200);

      // Back to strangers. Restoring the edge would let one party re-establish a
      // relationship the other never agreed to.
      expect(socialTables().follows.filter((edge) => edge.isDeleted !== true)).toHaveLength(0);
      const after = await followState(USER_ALICE, USER_BOB).expect(200);
      expect(after.body.isFollowing).toBe(false);
      expect(after.body.isBlocked).toBe(false);
    });

    it("reports the block state in both directions through the follow state endpoint", async () => {
      await http(app).post(`/api/v1/social/users/${USER_ALICE}/block`).set(asUser(USER_BOB)).send({}).expect(201);

      // Bob blocked Alice: Bob sees `isBlocked`, Alice sees `isBlockedBy`, and
      // the cached symmetric set cannot answer either on its own.
      expect((await followState(USER_BOB, USER_ALICE).expect(200)).body).toMatchObject({ isBlocked: true, isBlockedBy: false });
      expect((await followState(USER_ALICE, USER_BOB).expect(200)).body).toMatchObject({ isBlocked: false, isBlockedBy: true });
    });

    it("lists only the caller's own blocks, newest first", async () => {
      await http(app).post(`/api/v1/social/users/${USER_BOB}/block`).set(asUser(USER_ALICE)).send({}).expect(201);
      await http(app).post(`/api/v1/social/users/${USER_CAROL}/block`).set(asUser(USER_ALICE)).send({}).expect(201);
      await http(app).post(`/api/v1/social/users/${USER_DAVE}/block`).set(asUser(USER_BOB)).send({}).expect(201);

      const mine = await http(app).get("/api/v1/social/blocks").set(asUser(USER_ALICE)).expect(200);
      expect(mine.body.data.map((row: { id: string }) => row.id).sort()).toEqual([USER_BOB, USER_CAROL].sort());
      // Blocked content is not deleted; nothing else in the product branches on
      // the reason, so it is only ever the blocker's own bookkeeping.
      expect(mine.body.data[0].reason).toBeNull();
    });

    it("refuses a self-block", async () => {
      await http(app).post(`/api/v1/social/users/${USER_ALICE}/block`).set(asUser(USER_ALICE)).send({}).expect(400);
      await http(app).delete(`/api/v1/social/users/${USER_ALICE}/block`).set(asUser(USER_ALICE)).expect(400);
    });
  });

  /* ─────────────────────────────── likes ────────────────────────────────── */

  describe("likes", () => {
    it("moves the counter with the fact, 409s a second like, and unlike is idempotent", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "like me" }).expect(201);
      const postId = created.body.id as string;

      const liked = await like(USER_BOB, postId).expect(201);
      expect(liked.body).toEqual({ postId, liked: true, likeCount: 1 });

      await like(USER_BOB, postId).expect(409);
      expect(socialTables().likes).toHaveLength(1);
      expect(socialTables().posts[0].likeCount).toBe(1);

      const unliked = await unlike(USER_BOB, postId).expect(200);
      expect(unliked.body).toEqual({ postId, liked: false, likeCount: 0 });

      // The decrement is gated on the soft delete having matched a live row, so a
      // retry cannot drive the counter below the truth.
      await unlike(USER_BOB, postId).expect(200);
      await unlike(USER_BOB, postId).expect(200);
      expect(socialTables().posts[0].likeCount).toBe(0);
    });

    it("counts several likers independently and allows a like again after an unlike", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "popular" }).expect(201);
      const postId = created.body.id as string;

      await like(USER_BOB, postId).expect(201);
      const second = await like(USER_CAROL, postId).expect(201);
      expect(second.body.likeCount).toBe(2);

      await unlike(USER_BOB, postId).expect(200);
      // The pair index is partial, so the second attempt is not permanently refused.
      await like(USER_BOB, postId).expect(201);
      expect(socialTables().posts[0].likeCount).toBe(2);
    });

    it("refuses to like a post the caller cannot see", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "private", privacy: "private" }).expect(201);
      const postId = created.body.id as string;

      await like(USER_BOB, postId).expect(404);
      await unlike(USER_BOB, postId).expect(404);
      expect(socialTables().likes).toHaveLength(0);
    });

    it("rolls the like back when the counter statement fails, leaving no half-written state", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "atomic" }).expect(201);
      const postId = created.body.id as string;

      const engagement = app.get(PostEngagementService);
      const spy = jest.spyOn(engagement, "adjustLikes").mockRejectedValueOnce(new Error("counter write failed"));
      await like(USER_BOB, postId).expect(500);
      spy.mockRestore();

      // The fact row and the counter are one atomic write: a like committed
      // without its count is a permanent, invisible inconsistency.
      expect(socialTables().likes).toHaveLength(0);
      expect(socialTables().posts[0].likeCount).toBe(0);
    });

    it("answers a batched like-state read with one entry per id, in order", async () => {
      const liked = await createPost(USER_ALICE, { type: PostType.TEXT, body: "a" }).expect(201);
      const other = await createPost(USER_BOB, { type: PostType.TEXT, body: "b" }).expect(201);
      await like(USER_BOB, liked.body.id).expect(201);

      const response = await http(app)
        .post("/api/v1/social/likes/state")
        .set(asUser(USER_BOB))
        .send({ postIds: [other.body.id, liked.body.id, "40000000-0000-4000-8000-999999999999"] })
        .expect(201);

      // An id the caller cannot see is reported as not-liked rather than omitted,
      // so this endpoint is not an existence oracle and a client can index the
      // array positionally against the page it is rendering.
      expect(response.body.states).toEqual([
        { postId: other.body.id, liked: false },
        { postId: liked.body.id, liked: true },
        { postId: "40000000-0000-4000-8000-999999999999", liked: false }
      ]);
    });

    it("caps the batch read so its cost is not controlled by the client", async () => {
      const many = Array.from({ length: 51 }, () => "40000000-0000-4000-8000-000000000000");
      await http(app).post("/api/v1/social/likes/state").set(asUser(USER_BOB)).send({ postIds: many }).expect(400);
    });
  });

  /* ────────────────────────────── comments ──────────────────────────────── */

  describe("comments", () => {
    let postId: string;

    beforeEach(async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "discuss" }).expect(201);
      postId = created.body.id as string;
    });

    const list = (userId: string, query: Record<string, string> = {}) => http(app).get(`/api/v1/social/posts/${postId}/comments`).query(query).set(asUser(userId));

    it("counts a comment with the fact, and refuses an identical resubmission with 409", async () => {
      const first = await comment(USER_BOB, postId, { body: "nice work" }).expect(201);
      expect(first.body).toMatchObject({ body: "nice work", depth: 0, parentId: null, replyCount: 0, viewer: { isAuthor: true, canModify: true }, isDeleted: false });
      expect(first.body.author).toEqual({ id: USER_BOB, name: "Bob", avatarUrl: "https://app.test/avatars/bob.png" });
      expect(socialTables().posts[0].commentCount).toBe(1);

      // A client retrying a POST whose response was lost gets a 409 it can treat
      // as "already posted" rather than a visible duplicate thread.
      await comment(USER_BOB, postId, { body: "nice work" }).expect(409);
      await comment(USER_CAROL, postId, { body: "nice work" }).expect(201);
      expect(socialTables().comments).toHaveLength(2);
    });

    it("keeps the thread exactly one level deep", async () => {
      const parent = await comment(USER_BOB, postId, { body: "top" }).expect(201);
      const reply = await comment(USER_CAROL, postId, { body: "reply", parentId: parent.body.id }).expect(201);
      expect(reply.body.depth).toBe(1);
      expect(reply.body.parentId).toBe(parent.body.id);

      // A reply to a reply is a 404 rather than a depth-2 row.
      await comment(USER_DAVE, postId, { body: "reply to reply", parentId: reply.body.id }).expect(404);
      // A parent on a different post is refused for the same reason.
      const otherPost = await createPost(USER_ALICE, { type: PostType.TEXT, body: "elsewhere" }).expect(201);
      await comment(USER_DAVE, otherPost.body.id, { body: "wrong parent", parentId: parent.body.id }).expect(404);
    });

    it("bumps the parent's reply count with the reply, and decrements it on delete", async () => {
      const parent = await comment(USER_BOB, postId, { body: "top" }).expect(201);
      const reply = await comment(USER_CAROL, postId, { body: "reply", parentId: parent.body.id }).expect(201);
      expect(socialTables().comments[0].replyCount).toBe(1);

      await http(app).delete(`/api/v1/social/comments/${reply.body.id}`).set(asUser(USER_CAROL)).expect(200);
      expect(socialTables().comments[0].replyCount).toBe(0);
      // A reply does not count towards the post's comment total: that is live
      // top-level comments, which is what a reader counts.
      expect(socialTables().posts[0].commentCount).toBe(1);
    });

    it("turns a deleted comment into a tombstone that keeps its replies", async () => {
      const parent = await comment(USER_BOB, postId, { body: "something regrettable" }).expect(201);
      await comment(USER_CAROL, postId, { body: "reply", parentId: parent.body.id }).expect(201);

      await http(app).delete(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_BOB)).expect(200);
      // Idempotent, and a retry must not double-decrement the post.
      await http(app).delete(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_BOB)).expect(200);
      expect(socialTables().posts[0].commentCount).toBe(0);

      // The tombstone keeps the thread's shape: a hole would shift every keyset
      // boundary under the client and orphan the reply into a context-free quote.
      const asAuthor = await list(USER_BOB).expect(200);
      expect(asAuthor.body.data[0]).toMatchObject({ id: parent.body.id, body: "", isDeleted: true, viewer: { isAuthor: true, canModify: false } });
      // The reply is still there, still under its parent.
      expect(asAuthor.body.data.find((row: { id: string }) => row.id === parent.body.id)?.replies ?? asAuthor.body.data).toBeDefined();

      // A stranger gets 404 rather than a tombstone: it must not be a place to
      // confirm that a particular person said something here.
      const asStranger = await http(app).get(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_CAROL)).expect(404);
      expect(asStranger.body.message).toBe("Comment not found");
    });

    it("edits a comment's body but not its place in the thread", async () => {
      const parent = await comment(USER_BOB, postId, { body: "top" }).expect(201);
      await http(app).patch(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_BOB)).send({ body: "edited", parentId: null }).expect(200);
      expect(socialTables().comments[0].body).toBe("edited");
      expect(socialTables().comments[0].parentId).toBeNull();

      // Someone else's comment is a 404, not a 403.
      await http(app).patch(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_CAROL)).send({ body: "hijack" }).expect(404);
      expect(socialTables().comments[0].body).toBe("edited");
    });

    it("refuses an empty body", async () => {
      await comment(USER_BOB, postId, { body: "" }).expect(400);
      await comment(USER_BOB, postId, { body: "   " }).expect(400);
      expect(socialTables().comments).toHaveLength(0);
    });

    it("inherits the post's visibility, so an invisible post has no readable thread", async () => {
      const privatePost = await createPost(USER_ALICE, { type: PostType.TEXT, body: "private", privacy: "private" }).expect(201);
      await comment(USER_BOB, privatePost.body.id, { body: "sneaky" }).expect(404);
      await list(USER_BOB).query({}).set(asUser(USER_BOB));
      expect(socialTables().comments).toHaveLength(0);
    });

    it("nests replies oldest-first under `sort=top` and interleaves them flat under `sort=recent`", async () => {
      const first = await comment(USER_BOB, postId, { body: "first" }).expect(201);
      await comment(USER_CAROL, postId, { body: "second" }).expect(201);
      await comment(USER_DAVE, postId, { body: "reply one", parentId: first.body.id }).expect(201);
      await comment(USER_DAVE, postId, { body: "reply two", parentId: first.body.id }).expect(201);

      const top = await list(USER_ALICE, { sort: "top" }).expect(200);
      expect(top.body.data).toHaveLength(2);
      expect(top.body.data[0].replies.map((reply: { body: string }) => reply.body)).toEqual(["reply one", "reply two"]);
      expect(top.body.data[1].replies).toEqual([]);

      const recent = await list(USER_ALICE, { sort: "recent" }).expect(200);
      expect(recent.body.data).toHaveLength(4);
      expect(recent.body.data.every((row: { replies: unknown[] }) => row.replies.length === 0)).toBe(true);
    });

    it("pages a single conversation forwards, oldest first", async () => {
      const parent = await comment(USER_BOB, postId, { body: "top" }).expect(201);
      await comment(USER_CAROL, postId, { body: "one", parentId: parent.body.id }).expect(201);
      await comment(USER_DAVE, postId, { body: "two", parentId: parent.body.id }).expect(201);

      const page = await list(USER_ALICE, { parentId: parent.body.id, limit: "1" }).expect(200);
      expect(page.body.data.map((row: { body: string }) => row.body)).toEqual(["one"]);
      expect(page.body.meta.hasMore).toBe(true);

      const second = await list(USER_ALICE, { parentId: parent.body.id, limit: "1", cursor: page.body.meta.nextCursor }).expect(200);
      expect(second.body.data.map((row: { body: string }) => row.body)).toEqual(["two"]);
      expect(second.body.meta).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it("refuses a `parentId` that names a reply rather than a top-level comment", async () => {
      const parent = await comment(USER_BOB, postId, { body: "top" }).expect(201);
      const reply = await comment(USER_CAROL, postId, { body: "reply", parentId: parent.body.id }).expect(201);
      await list(USER_ALICE, { parentId: reply.body.id }).expect(404);
    });

    it("rejects a cursor minted under the other ordering", async () => {
      await comment(USER_BOB, postId, { body: "first" }).expect(201);
      await comment(USER_CAROL, postId, { body: "second" }).expect(201);

      const topPage = await list(USER_ALICE, { sort: "top", limit: "1" }).expect(200);
      // A client that switches `sort` mid-pagination restarts rather than
      // receiving a scrambled thread.
      await list(USER_ALICE, { sort: "recent", limit: "1", cursor: topPage.body.meta.nextCursor }).expect(400);
    });

    it("notifies the post's author, or the parent commenter for a reply, but never the author of the comment", async () => {
      await comment(USER_ALICE, postId, { body: "talking to myself" }).expect(201);
      expect(recordedEvents()).toHaveLength(0);

      await comment(USER_BOB, postId, { body: "hello" }).expect(201);
      expect(recordedEvents().map((event) => event.audience.userIds[0])).toEqual([USER_ALICE]);

      const parent = await comment(USER_BOB, postId, { body: "hello again" }).expect(201);
      await comment(USER_CAROL, postId, { body: "reply", parentId: parent.body.id }).expect(201);
      // Every top-level comment notifies the post author; a reply notifies the
      // parent commenter instead. Bob's two comments each notify Alice.
      expect(recordedEvents().map((event) => event.audience.userIds[0])).toEqual([USER_ALICE, USER_ALICE, USER_BOB]);
    });
  });

  /* ────────────────────────────── reports ───────────────────────────────── */

  describe("reports", () => {
    const report = (userId: string, body: Record<string, unknown>) => http(app).post("/api/v1/social/reports").set(asUser(userId)).send(body);

    it("refuses to report a post the reporter cannot see", async () => {
      const privatePost = await createPost(USER_ALICE, { type: PostType.TEXT, body: "private", privacy: "private" }).expect(201);
      await report(USER_BOB, { targetType: ReportTargetType.POST, postId: privatePost.body.id, reason: ReportReason.SPAM }).expect(404);
      expect(socialTables().reports).toHaveLength(0);
    });

    it("reports a visible post and snapshots its author and an excerpt", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "spam spam buy now" }).expect(201);
      const response = await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM, details: "  " }).expect(201);

      expect(response.body).toMatchObject({
        targetType: "post",
        postId: created.body.id,
        userId: null,
        commentId: null,
        reason: "spam",
        details: null,
        status: ReportStatus.REPORTED,
        targetAuthorId: USER_ALICE,
        targetExcerpt: "spam spam buy now"
      });
      // A reporter is told that something was reported and where it is in triage —
      // not who they are to the system, and nothing about internal handling.
      expect(response.body.reporterId).toBeUndefined();
      expect(response.body.resolutionNote).toBeUndefined();
    });

    it("keeps the snapshot after the target is deleted, which is when a human needs it", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "evidence" }).expect(201);
      const filed = await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.HARASSMENT }).expect(201);

      await http(app).delete(`/api/v1/social/posts/${created.body.id}`).set(asUser(USER_ALICE)).expect(200);
      const still = await http(app).get(`/api/v1/social/reports/${filed.body.id}`).set(asUser(USER_BOB)).expect(200);
      expect(still.body.targetExcerpt).toBe("evidence");
      expect(still.body.targetAuthorId).toBe(USER_ALICE);
    });

    it("returns the existing report for a duplicate, including for a POST target whose other id columns are NULL", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "reported" }).expect(201);
      const first = await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);

      // The dedupe lookup must use `IsNull()`: a bare `null` in a
      // `FindOptionsWhere` is ignored rather than turned into `IS NULL`, so a
      // naive lookup would match any report with no `user_id` — i.e. every POST
      // report. This is the test that would catch exactly that.
      const repeat = await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);
      expect(repeat.body.id).toBe(first.body.id);
      expect(socialTables().reports).toHaveLength(1);

      // A different reporter, and a different target, are both fine: the
      // guarantee is "this person has already said so", not "this is reported".
      await report(USER_CAROL, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);
      expect(socialTables().reports).toHaveLength(2);
    });

    it("reports a comment, including one the reporter wrote", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "discuss" }).expect(201);
      const mine = await comment(USER_BOB, created.body.id, { body: "something I now regret" }).expect(201);

      const response = await report(USER_BOB, { targetType: ReportTargetType.COMMENT, commentId: mine.body.id, reason: ReportReason.OTHER }).expect(201);
      expect(response.body).toMatchObject({ commentId: mine.body.id, postId: null, userId: null, targetAuthorId: USER_BOB });
    });

    it("reports a user regardless of whether you can see their content, but never yourself", async () => {
      // The most important thing to report is frequently behaviour that left no
      // artifact, so a user report has no visibility gate at all.
      await report(USER_BOB, { targetType: ReportTargetType.USER, userId: USER_ALICE, reason: ReportReason.HARASSMENT }).expect(201);
      expect(socialTables().reports[0]).toMatchObject({ userId: USER_ALICE, postId: null, commentId: null, targetExcerpt: null });

      await report(USER_BOB, { targetType: ReportTargetType.USER, userId: USER_BOB, reason: ReportReason.SPAM }).expect(400);
      await report(USER_BOB, { targetType: ReportTargetType.USER, userId: "40000000-0000-4000-8000-999999999999", reason: ReportReason.SPAM }).expect(404);
    });

    it("requires the id that matches the declared target type", async () => {
      await report(USER_BOB, { targetType: ReportTargetType.USER, reason: ReportReason.SPAM }).expect(400);
      await report(USER_BOB, { targetType: ReportTargetType.POST, reason: ReportReason.SPAM }).expect(400);
      await report(USER_BOB, { targetType: ReportTargetType.COMMENT, reason: ReportReason.SPAM }).expect(400);
    });

    it("rejects a reason outside the closed set", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "x" }).expect(201);
      await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: "because_i_said_so" }).expect(400);
    });

    it("scopes history to the reporter, so another reporter's id is indistinguishable from a missing one", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "x" }).expect(201);
      const bobs = await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);
      const carols = await report(USER_CAROL, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);

      const mine = await http(app).get("/api/v1/social/reports").set(asUser(USER_BOB)).expect(200);
      expect(mine.body.data.map((row: { id: string }) => row.id)).toEqual([bobs.body.id]);

      // There is no code path that loads a report without already constraining
      // it to the caller, so there is no 403 to leak here.
      await http(app).get(`/api/v1/social/reports/${bobs.body.id}`).set(asUser(USER_CAROL)).expect(404);
      await http(app).get(`/api/v1/social/reports/${carols.body.id}`).set(asUser(USER_BOB)).expect(404);
    });

    it("pages and filters the reporter's own history", async () => {
      const first = await createPost(USER_ALICE, { type: PostType.TEXT, body: "a" }).expect(201);
      const second = await createPost(USER_BOB, { type: PostType.TEXT, body: "b" }).expect(201);
      await report(USER_BOB, { targetType: ReportTargetType.POST, postId: first.body.id, reason: ReportReason.SPAM }).expect(201);
      await report(USER_BOB, { targetType: ReportTargetType.POST, postId: second.body.id, reason: ReportReason.SPAM }).expect(201);

      const page = await http(app).get("/api/v1/social/reports").query({ limit: "1" }).set(asUser(USER_BOB)).expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.hasMore).toBe(true);

      const next = await http(app).get("/api/v1/social/reports").query({ limit: "1", cursor: page.body.meta.nextCursor }).set(asUser(USER_BOB)).expect(200);
      expect(next.body.data).toHaveLength(1);
      expect(next.body.data[0].id).not.toBe(page.body.data[0].id);
      expect(next.body.meta).toMatchObject({ hasMore: false, nextCursor: null });

      const byType = await http(app).get("/api/v1/social/reports").query({ targetType: ReportTargetType.USER }).set(asUser(USER_BOB)).expect(200);
      expect(byType.body.data).toEqual([]);
    });

    it("counts distinct reporters rather than reports, for the moderation tool", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "x" }).expect(201);
      await report(USER_BOB, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);
      await report(USER_CAROL, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);
      await report(USER_DAVE, { targetType: ReportTargetType.POST, postId: created.body.id, reason: ReportReason.SPAM }).expect(201);

      // Not exposed over HTTP on purpose: the whole-queue query belongs to a tool
      // with its own role check, not to a public route.
      const service = app.get(ReportsService);
      const count = await service.distinctReporterCount({ targetType: ReportTargetType.POST, postId: created.body.id });
      expect(count).toBe(3);
    });
  });

  /* ─────────────────────── cross-module: counts & threads ──────────────── */

  describe("cross-module invariants", () => {
    it("keeps a post's counters equal to the live like and top-level comment counts", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "counters" }).expect(201);
      const postId = created.body.id as string;

      await like(USER_BOB, postId).expect(201);
      await like(USER_CAROL, postId).expect(201);
      const parent = await comment(USER_DAVE, postId, { body: "top" }).expect(201);
      await comment(USER_BOB, postId, { body: "reply", parentId: parent.body.id }).expect(201);

      expect(socialTables().posts[0]).toMatchObject({ likeCount: 2, commentCount: 1 });

      const shown = await postById(USER_CAROL, postId).expect(200);
      expect(shown.body).toMatchObject({ likeCount: 2, commentCount: 1 });
    });

    it("keeps a comment's reply count equal to its live replies", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "thread" }).expect(201);
      const parent = await comment(USER_BOB, created.body.id, { body: "top" }).expect(201);
      const a = await comment(USER_CAROL, created.body.id, { body: "a", parentId: parent.body.id }).expect(201);
      const b = await comment(USER_DAVE, created.body.id, { body: "b", parentId: parent.body.id }).expect(201);

      await http(app).delete(`/api/v1/social/comments/${a.body.id}`).set(asUser(USER_CAROL)).expect(200);
      const shown = await comments(USER_ALICE, created.body.id, { parentId: parent.body.id }).expect(200);
      expect(shown.body.data.map((row: { id: string }) => row.id)).toEqual([b.body.id]);
      expect(socialTables().comments[0].replyCount).toBe(1);
    });

    it("gives the comments service no way to reach a post it cannot see", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "followers", privacy: "followers" }).expect(201);
      // Bob follows Alice first, so the followers-only post is visible to him.
      insertFollow(USER_BOB, USER_ALICE);
      const parent = await comment(USER_BOB, created.body.id, { body: "top" }).expect(201);

      // Carol never followed Alice, so the whole thread is invisible to her
      // rather than just filtered afterwards.
      await http(app).get(`/api/v1/social/comments/${parent.body.id}`).set(asUser(USER_CAROL)).expect(404);
      await comments(USER_CAROL, created.body.id).expect(404);

      const visible = await comments(USER_BOB, created.body.id).expect(200);
      expect(visible.body.data).toHaveLength(1);
    });

    it("exposes the comment assembler as one shape regardless of which service built it", async () => {
      const created = await createPost(USER_ALICE, { type: PostType.TEXT, body: "x" }).expect(201);
      const made = await comment(USER_BOB, created.body.id, { body: "hello" }).expect(201);

      // The service and the HTTP layer must produce the same DTO, or the list and
      // the point read disagree about what a comment is.
      const service = app.get(CommentsService);
      const direct = await service.getOne(USER_ALICE, made.body.id);
      expect(direct).toMatchObject({ id: made.body.id, body: "hello", depth: 0, isDeleted: false });
    });
  });
});

/** The fixture workout's `startedAt`, hoisted so the share assertion stays readable. */
const WORKOUT_UNUSED_START = at(-48).toISOString();
