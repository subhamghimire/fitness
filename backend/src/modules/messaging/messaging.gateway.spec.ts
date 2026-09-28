import { JwtService } from "@nestjs/jwt";
import { Repository } from "typeorm";
import type { Server } from "socket.io";
import { User } from "src/modules/users/entities/user.entity";
import { SendMessageDto } from "./dto";
import { AuthedSocket, AckFn, CLIENT_EVENTS, MessagingGateway, SERVER_EVENTS, SOCKET_ERROR_CODES } from "./messaging.gateway";
import { MessageStoredEvent, MessagingRealtimeBus } from "./messaging-realtime.bus";
import { MessagingService } from "./messaging.service";
import { SocketIdentity, conversationRoom } from "./messaging-socket-authenticator";

/**
 * MESSAGING GATEWAY
 *
 * The gateway makes no authorisation decisions of its own — it delegates every
 * one to `MessagingService`. What it *does* own, and what this suite defends, is
 * the three-part contract a socket must satisfy before a frame is handled:
 *
 *   1. AUTHENTICATION. An unauthenticated socket is disconnected at connect and
 *      refused on every frame, so there is no path from "connected" to "acted".
 *   2. MEMBERSHIP. A frame naming a conversation re-validates membership rather
 *      than trusting the connect-time room set, so a user removed from a thread
 *      after connecting stops immediately.
 *   3. ERROR SHAPE. Every rejection becomes a structured `error` frame and a
 *      matching ack, so a client can branch on a code instead of timing out.
 *
 * A non-member is told `not_a_participant` — the same 404 the HTTP API gives, so
 * the socket surface is no more of an existence oracle than the REST one.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const OTHER = "99999999-9999-4999-8999-999999999999";
const TOKEN = "a.b.c";

/** The frame body `handleSendMessage` accepts: the conversation id plus sendable fields. */
type SendFrameBody = { conversationId?: string } & Partial<SendMessageDto>;

/** Coerces an untyped payload into a frame body, the way Socket.IO's decoder would. */
const sendFrameBody = (body: Record<string, unknown>): SendFrameBody => body as unknown as SendFrameBody;

/** Minimal Socket.IO double: records emits, joins and room-scoped sends. */
const makeSocket = (identity: SocketIdentity | undefined) => {
  // The room broadcast target: `client.to(room).emit(...)` — "everyone else".
  const toEmit = jest.fn();
  const toRoom = jest.fn((): { emit: jest.Mock } => ({ emit: toEmit }));

  const client = {
    id: `socket-${Math.random().toString(16).slice(2)}`,
    handshake: { auth: { token: TOKEN }, query: {}, headers: {} },
    data: { identity, joinedConversations: identity ? new Set<string>() : undefined },
    emitted: [] as { event: string; payload: unknown }[],
    joined: [] as string[],
    left: [] as string[],
    disconnected: false,
    emit: jest.fn((event: string, payload: unknown) => {
      client.emitted.push({ event, payload });
    }),
    join: jest.fn((room: string) => {
      client.joined.push(room);
    }),
    leave: jest.fn((room: string) => {
      client.left.push(room);
    }),
    disconnect: jest.fn(() => {
      client.disconnected = true;
    }),
    to: toRoom,
    toEmit
  };
  return client as unknown as AuthedSocket & {
    emitted: { event: string; payload: unknown }[];
    joined: string[];
    left: string[];
    disconnected: boolean;
    join: jest.Mock;
    leave: jest.Mock;
    disconnect: jest.Mock;
    to: jest.Mock;
    toEmit: jest.Mock;
  };
};

const makeGateway = (options: { conversationIds?: string[]; userExists?: boolean; tokenValid?: boolean } = {}) => {
  const conversationIds = options.conversationIds ?? [CONVERSATION];
  const userExists = options.userExists ?? true;
  const tokenValid = options.tokenValid ?? true;

  const activeConversationIds = jest.fn().mockResolvedValue(conversationIds);
  const requireMembership = jest.fn<Promise<{ userId: string; conversationId: string }>, [userId: string, conversationId: string]>();
  requireMembership.mockResolvedValue({ userId: ALICE, conversationId: CONVERSATION });
  const sendMessage = jest.fn().mockResolvedValue({ message: { id: "m1", body: "hi" }, duplicate: false });
  const markRead = jest.fn().mockResolvedValue({ conversationId: CONVERSATION, lastReadMessageId: "m1", lastReadAt: new Date("2026-02-02T12:00:00Z"), unreadCount: 0 });
  const markDelivered = jest.fn().mockResolvedValue({ conversationId: CONVERSATION, lastDeliveredMessageId: "m1", lastDeliveredAt: new Date(), receiptsUpdated: 2 });

  const messagingService = {
    activeConversationIds,
    requireMembership,
    sendMessage,
    markRead,
    markDelivered
  } as unknown as MessagingService;

  const realtimeBus = new MessagingRealtimeBus();

  const verifyAsync = tokenValid ? jest.fn().mockResolvedValue({ sub: ALICE }) : jest.fn().mockRejectedValue(new Error("jwt expired"));
  const jwtService = { verifyAsync } as unknown as JwtService;

  const usersRepo = {
    findOne: jest.fn().mockResolvedValue(userExists ? { id: ALICE, name: "Alice" } : null)
  } as unknown as Repository<User>;

  const serverEmit = jest.fn();
  const serverTo = jest.fn((): { emit: jest.Mock } => ({ emit: serverEmit }));
  const gateway = new MessagingGateway(messagingService, realtimeBus, jwtService, usersRepo);
  gateway.server = { to: serverTo } as unknown as Server;
  gateway.onModuleInit();

  return {
    gateway,
    messagingService,
    realtimeBus,
    jwtService,
    usersRepo,
    activeConversationIds,
    requireMembership,
    sendMessage,
    markRead,
    markDelivered,
    verifyAsync,
    serverTo,
    serverEmit
  };
};

const identity = (userId = ALICE, name: string | null = "Alice"): SocketIdentity => ({ userId, name });

describe("MessagingGateway — handshake authentication", () => {
  it("authenticates once, then auto-joins exactly the rooms the user belongs to", async () => {
    const { gateway, activeConversationIds, verifyAsync } = makeGateway({ conversationIds: [CONVERSATION] });
    const client = makeSocket(undefined);

    await gateway.handleConnection(client);

    // The token is verified once, at the handshake — never per frame.
    expect(verifyAsync).toHaveBeenCalledWith(TOKEN);
    expect(client.data.identity).toEqual({ userId: ALICE, name: "Alice" });
    // Membership becomes *rooms*, so there is no such thing as subscribing to a
    // conversation you are not in.
    expect(client.joined).toEqual([conversationRoom(CONVERSATION)]);
    expect(client.data.joinedConversations).toEqual(new Set([CONVERSATION]));
    expect(activeConversationIds).toHaveBeenCalledWith(ALICE);
    expect(client.emitted).toContainEqual({ event: SERVER_EVENTS.ready, payload: { userId: ALICE, conversations: [CONVERSATION] } });
  });

  it("disconnects a socket whose token does not verify", async () => {
    const { gateway, activeConversationIds, sendMessage } = makeGateway({ tokenValid: false });
    const client = makeSocket(undefined);

    await gateway.handleConnection(client);

    expect(client.disconnected).toBe(true);
    // No identity, and no room set computed for one.
    expect(client.data.identity).toBeUndefined();
    expect(client.joined).toEqual([]);
    expect(activeConversationIds).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("disconnects a socket for a deleted account, even with a still-valid token", async () => {
    const { gateway } = makeGateway({ userExists: false });
    const client = makeSocket(undefined);

    await gateway.handleConnection(client);

    // A JWT is stateless and would otherwise stay usable until it expired.
    expect(client.disconnected).toBe(true);
  });

  it("tells the client the token is the problem, so it can refresh and retry", async () => {
    const { gateway } = makeGateway({ userExists: false });
    const client = makeSocket(undefined);

    await gateway.handleConnection(client);

    expect(client.emitted).toEqual([{ event: SERVER_EVENTS.error, payload: { code: SOCKET_ERROR_CODES.UNAUTHORIZED, message: "Authentication failed" } }]);
  });
});

describe("MessagingGateway — every frame is refused without an identity", () => {
  it("rejects each client frame on a socket that never authenticated", async () => {
    const { gateway, requireMembership, sendMessage, markRead, markDelivered } = makeGateway();
    const client = makeSocket(undefined);
    const ack = jest.fn() as AckFn;

    const results = await Promise.all([
      gateway.handleJoinConversation(client, { conversationId: CONVERSATION }),
      gateway.handleSendMessage(client, { conversationId: CONVERSATION, clientMessageId: "cm-1", body: "hi" }, ack),
      gateway.handleMarkRead(client, { conversationId: CONVERSATION }, ack),
      gateway.handleMarkDelivered(client, { conversationId: CONVERSATION, lastDeliveredMessageId: "m1" }, ack),
      gateway.handleTyping(client, { conversationId: CONVERSATION, isTyping: true })
    ]);

    // The identity gate is inside `frame`, so it cannot be forgotten by a
    // handler — and nothing reached the service.
    expect(results.every((r) => r === undefined)).toBe(true);
    expect(client.joined).toEqual([]);
    expect(requireMembership).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ ok: false, code: SOCKET_ERROR_CODES.UNAUTHORIZED, error: "Socket is not authenticated" });
  });
});

describe("MessagingGateway — membership is re-validated per frame", () => {
  it("refuses a join for a conversation the socket is not in", async () => {
    const { gateway, requireMembership } = makeGateway();
    const client = makeSocket(identity());
    requireMembership.mockRejectedValue(new UnauthorizedError404());

    const result = await gateway.handleJoinConversation(client, { conversationId: OTHER });

    expect(result).toBeUndefined();
    expect(client.joined).toEqual([]);
    expect(client.emitted).toContainEqual({ event: SERVER_EVENTS.error, payload: { code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT, message: "Conversation not found" } });
  });

  /**
   * The room set is computed once at connect, so it goes stale when somebody is
   * removed. The send frame's authorisation therefore lives entirely in the
   * service — the gateway adds no second, weaker check, it just translates the
   * denial into a code the client can branch on.
   */
  it("surfaces a removal mid-session as not_a_participant and writes nothing", async () => {
    const { gateway, sendMessage } = makeGateway();
    const client = makeSocket(identity());
    client.data.joinedConversations = new Set([CONVERSATION]);
    // The service is the authority, and it refuses the revoked membership.
    sendMessage.mockRejectedValue(new UnauthorizedError404());

    const ack = jest.fn() as AckFn;
    const result = await gateway.handleSendMessage(client, { conversationId: CONVERSATION, clientMessageId: "cm-1", body: "hi" }, ack);

    expect(result).toBeUndefined();
    expect(ack).toHaveBeenCalledWith({ ok: false, code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT, error: "Conversation not found" });
    expect(client.emitted).toContainEqual({ event: SERVER_EVENTS.error, payload: { code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT, message: "Conversation not found" } });
  });

  it("refuses a typing indicator for a non-member, because it emits to a room", async () => {
    const { gateway, requireMembership } = makeGateway();
    const client = makeSocket(identity());
    requireMembership.mockRejectedValue(new UnauthorizedError404());

    const result = await gateway.handleTyping(client, { conversationId: OTHER, isTyping: true });

    expect(result).toBeUndefined();
    expect(client.to).not.toHaveBeenCalled();
  });

  it("lets a member who was just added join without reconnecting", async () => {
    const { gateway } = makeGateway();
    const client = makeSocket(identity());

    const result = await gateway.handleJoinConversation(client, { conversationId: OTHER });

    expect(result).toEqual({ ok: true, conversationId: OTHER });
    expect(client.joined).toEqual([conversationRoom(OTHER)]);
    expect(client.data.joinedConversations).toEqual(new Set([OTHER]));
  });

  it("leaving needs no membership check — a non-member was never in the room", async () => {
    const { gateway, requireMembership } = makeGateway();
    const client = makeSocket(identity());

    const result = await gateway.handleLeaveConversation(client, { conversationId: CONVERSATION });

    expect(result).toEqual({ ok: true, conversationId: CONVERSATION });
    expect(client.left).toEqual([conversationRoom(CONVERSATION)]);
    expect(requireMembership).not.toHaveBeenCalled();
  });
});

describe("MessagingGateway — sending over a socket", () => {
  it("sends on behalf of the handshake identity, never one named in the frame", async () => {
    const { gateway, sendMessage } = makeGateway();
    const client = makeSocket(identity(ALICE));

    // A frame claiming to be somebody else is ignored: the identity is the only
    // source of "who", and it was established once at the handshake.
    const result = await gateway.handleSendMessage(client, sendFrameBody({ conversationId: CONVERSATION, clientMessageId: "cm-1", body: "hi", userId: BOB }), undefined);

    expect(sendMessage).toHaveBeenCalledWith(ALICE, CONVERSATION, {
      clientMessageId: "cm-1",
      body: "hi",
      replyToId: undefined,
      type: undefined,
      metadata: undefined
    });
    expect(result).toEqual({ message: { id: "m1", body: "hi" }, duplicate: false });
  });

  it("acks success with the payload the client needs to settle its optimistic bubble", async () => {
    const { gateway } = makeGateway();
    const client = makeSocket(identity());
    const ack = jest.fn() as AckFn;

    await gateway.handleSendMessage(client, { conversationId: CONVERSATION, clientMessageId: "cm-1", body: "hi" }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true, data: { message: { id: "m1", body: "hi" }, duplicate: false } });
  });

  it("rejects a malformed frame with bad_request rather than touching the service", async () => {
    const { gateway, sendMessage } = makeGateway();
    const client = makeSocket(identity());
    const ack = jest.fn() as AckFn;

    const missingConversation = await gateway.handleSendMessage(client, sendFrameBody({ clientMessageId: "cm-1", body: "hi" }), ack);
    const missingClientId = await gateway.handleSendMessage(client, sendFrameBody({ conversationId: CONVERSATION, body: "hi" }), ack);
    const wrongType = await gateway.handleSendMessage(client, sendFrameBody({ conversationId: CONVERSATION, clientMessageId: "cm-1", body: 42 }), ack);

    expect([missingConversation, missingClientId, wrongType]).toEqual([undefined, undefined, undefined]);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(ack).toHaveBeenLastCalledWith({ ok: false, code: SOCKET_ERROR_CODES.BAD_REQUEST, error: "body must be a string" });
  });

  it("reports a genuine server fault as internal_error without leaking the detail as a code", async () => {
    const { gateway, sendMessage } = makeGateway();
    const client = makeSocket(identity());
    sendMessage.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const ack = jest.fn() as AckFn;

    await gateway.handleSendMessage(client, { conversationId: CONVERSATION, clientMessageId: "cm-1", body: "hi" }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, code: SOCKET_ERROR_CODES.INTERNAL, error: "connection terminated unexpectedly" });
    expect(client.emitted).toContainEqual({ event: SERVER_EVENTS.error, payload: { code: SOCKET_ERROR_CODES.INTERNAL, message: "connection terminated unexpectedly" } });
  });
});

describe("MessagingGateway — read and delivery state fan out to the room", () => {
  it("reports a user's read state to the others, not back to the reader", async () => {
    const { gateway } = makeGateway();
    const client = makeSocket(identity());

    await gateway.handleMarkRead(client, { conversationId: CONVERSATION, lastReadMessageId: "m1" });

    // `client.to(room)`, not `server.to(room)`: read state is private to the
    // reader, and nobody else in the thread needs it.
    expect(client.to).toHaveBeenCalledWith(conversationRoom(CONVERSATION));
    expect(client.toEmit).toHaveBeenCalledWith(SERVER_EVENTS.readStateChanged, expect.objectContaining({ conversationId: CONVERSATION, userId: ALICE, lastReadMessageId: "m1" }));
  });

  it("reports a delivery receipt to the rest of the room, which is what draws the tick", async () => {
    const { gateway } = makeGateway();
    const client = makeSocket(identity());

    await gateway.handleMarkDelivered(client, { conversationId: CONVERSATION, lastDeliveredMessageId: "m1" });

    expect(client.to).toHaveBeenCalledWith(conversationRoom(CONVERSATION));
    expect(client.toEmit).toHaveBeenCalledWith(
      SERVER_EVENTS.deliveryStateChanged,
      expect.objectContaining({ conversationId: CONVERSATION, userId: ALICE, lastDeliveredMessageId: "m1", receiptsUpdated: 2 })
    );
  });

  it("broadcasts a stored message to the conversation room via the server", () => {
    const { realtimeBus, sendMessage, serverTo, serverEmit } = makeGateway();

    // The bus fires only after the send transaction committed.
    realtimeBus.publish({ conversationId: CONVERSATION, message: { id: "m1", conversationId: CONVERSATION, senderId: ALICE, body: "hi" } } as unknown as MessageStoredEvent);

    // The stored message travels through unchanged: `server.to(room)` is what the
    // redis-adapter intercepts, so one call reaches sockets held by other
    // instances with no relay code here.
    expect(serverTo).toHaveBeenCalledWith(conversationRoom(CONVERSATION));
    expect(serverEmit).toHaveBeenCalledWith(SERVER_EVENTS.messageCreated, {
      conversationId: CONVERSATION,
      message: { id: "m1", conversationId: CONVERSATION, senderId: ALICE, body: "hi" }
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops broadcasting once the module is destroyed", () => {
    const { gateway, realtimeBus, serverTo } = makeGateway();
    gateway.onModuleDestroy();

    realtimeBus.publish({ conversationId: CONVERSATION, message: { id: "m2" } } as unknown as MessageStoredEvent);

    expect(serverTo).not.toHaveBeenCalled();
  });
});

describe("MessagingGateway — frame names are the shared contract", () => {
  /**
   * `message:read`, `message:delivered` and `typing` travel in *both*
   * directions under one name. That is safe only because the server broadcasts
   * state frames with `client.to(...)` — excluding the reporter — so a client can
   * never receive an echo of its own report and confuse the two. If a frame were
   * ever broadcast with `server.to(...)` instead, this pairing would start
   * delivering a duplicate to its own author.
   */
  it("reuses a name in both directions only for frames the server sends with client.to()", async () => {
    const clientNames = new Set<string>(Object.values(CLIENT_EVENTS));
    const shared = Object.values(SERVER_EVENTS).filter((name) => clientNames.has(name));
    expect(new Set(shared)).toEqual(new Set([SERVER_EVENTS.readStateChanged, SERVER_EVENTS.deliveryStateChanged, SERVER_EVENTS.typing]));

    const { gateway } = makeGateway();
    const client = makeSocket(identity());

    // Each of those three frames really does exclude its own reporter.
    await gateway.handleMarkRead(client, { conversationId: CONVERSATION, lastReadMessageId: "m1" });
    await gateway.handleMarkDelivered(client, { conversationId: CONVERSATION, lastDeliveredMessageId: "m1" });
    await gateway.handleTyping(client, { conversationId: CONVERSATION, isTyping: true });

    expect(client.to).toHaveBeenCalledTimes(3);
    expect(client.to).toHaveBeenCalledWith(conversationRoom(CONVERSATION));
  });
});

/** A 404, exactly as `MessagingService.requireMembership` throws it. */
class UnauthorizedError404 extends Error {
  readonly status = 404;
  readonly response = { message: "Conversation not found" };
}
