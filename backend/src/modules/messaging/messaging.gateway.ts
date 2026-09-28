import { Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Ack, ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { User } from "src/modules/users/entities/user.entity";
import { DeliveryStateResponseDto, MessageResponseDto, ReadStateResponseDto, SendMessageDto, SendMessageResponseDto } from "./dto";
import { MessagingAccessException, MessagingService } from "./messaging.service";
import { MessageStoredEvent, MessagingRealtimeBus } from "./messaging-realtime.bus";
import { conversationRoom, SocketAuthenticator, SocketIdentity } from "./messaging-socket-authenticator";

/** Namespace, so messaging sockets stay a separate surface from any future one. */
export const MESSAGING_NAMESPACE = "/messaging";

/** Server → client frame names. */
export const SERVER_EVENTS = {
  messageCreated: "message:created",
  readStateChanged: "message:read",
  deliveryStateChanged: "message:delivered",
  typing: "typing",
  joined: "conversation:joined",
  ready: "ready",
  error: "error"
} as const;

/** Client → server frame names. */
export const CLIENT_EVENTS = {
  joinConversation: "conversation:join",
  leaveConversation: "conversation:leave",
  sendMessage: "message:send",
  markRead: "message:read",
  markDelivered: "message:delivered",
  typing: "typing"
} as const;

/** Socket data. The identity is established once, during the handshake. */
export interface AuthedSocket extends Socket {
  data: { identity?: SocketIdentity; joinedConversations?: Set<string> };
}

/** Optional ack callback — a socket.io client may omit it. */
export type AckFn = (response: { ok: true; data?: unknown } | { ok: false; code: string; error: string }) => void;

/** Error codes a client may branch on. */
export const SOCKET_ERROR_CODES = {
  UNAUTHORIZED: "unauthorized",
  NOT_A_PARTICIPANT: "not_a_participant",
  FORBIDDEN: "forbidden",
  BAD_REQUEST: "bad_request",
  INTERNAL: "internal_error"
} as const;

/**
 * MESSAGING GATEWAY
 * ---------------------------------------------------------------------------
 * Socket.IO transport for conversations. It owns *transport* concerns only —
 * handshake authentication, room membership, frame naming, and turning thrown
 * errors into structured `error` frames. Every business rule lives in
 * `MessagingService`, which both this gateway and the REST controller call, so a
 * frame and an HTTP request can never diverge in what they allow.
 *
 * ─── The three checks, and where each one happens ───────────────────────────
 * A frame is only ever handled on behalf of an identity that has passed all
 * three, and they are structurally separated rather than repeated per handler:
 *
 *   1. AUTHENTICATION — once, in `handleConnection`, via `SocketAuthenticator`.
 *      A socket with no valid identity is disconnected before any frame handler
 *      can run, and every handler opens with `identityOf()`, which throws rather
 *      than proceeding. There is no path that reaches a frame handler without
 *      having been authenticated.
 *   2. MEMBERSHIP — the socket is auto-joined to exactly the rooms its user is an
 *      active participant of, computed once from `activeConversationIds`. That
 *      makes "subscribe to a conversation you are not in" impossible rather than
 *      merely rejected: there is no such room for the socket to be in.
 *   3. AUTHORISATION — each handler delegates to the same service method the REST
 *      controller calls, which re-checks membership (and role, where the action
 *      needs a moderator) per request.
 *
 * (2) is a broadcast optimisation, never the authorisation decision. The room
 * set is computed once at connect, so it goes stale when somebody is removed
 * from a thread; `assertMember` therefore re-validates on every frame that names
 * a conversation. A non-member gets the same 404 the HTTP API uses, rather than
 * a 403 that would confirm the id exists and turn the id space into an oracle for
 * enumerating who is talking to whom.
 *
 * ─── Horizontal scaling ─────────────────────────────────────────────────────
 * One instance broadcasts fine on its own. Across instances,
 * `MessagingIoAdapter` attaches Socket.IO's redis-adapter, so
 * `server.to(room).emit(...)` fans out through Redis and reaches sockets held by
 * any instance. The service emits on a local in-process bus; cross-instance
 * correctness is the adapter's job, and there is no custom relay code here.
 */
@WebSocketGateway({ namespace: MESSAGING_NAMESPACE, transports: ["websocket", "polling"], cors: { origin: true, credentials: true } })
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingGateway.name);
  private readonly authenticator: SocketAuthenticator;
  private subscription: { unsubscribe(): void } | undefined;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly messagingService: MessagingService,
    private readonly realtimeBus: MessagingRealtimeBus,
    jwtService: JwtService,
    @InjectRepository(User) usersRepo: Repository<User>
  ) {
    this.authenticator = new SocketAuthenticator(jwtService, usersRepo);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  onModuleInit(): void {
    // Fan-out happens here, on the local bus, only after the send transaction
    // has committed — no subscriber can observe a message that later rolls back.
    this.subscription = this.realtimeBus.messageStored$.subscribe((event) => this.broadcastMessage(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Authenticate, then auto-join exactly the rooms the user may receive frames
   * for. A failure disconnects: a socket that is not authenticated participates
   * in nothing, so there is no degraded mode to fall back to.
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const identity = await this.authenticator.authenticate(client.handshake);
      client.data.identity = identity;

      const conversationIds = await this.messagingService.activeConversationIds(identity.userId);
      for (const conversationId of conversationIds) await client.join(conversationRoom(conversationId));
      client.data.joinedConversations = new Set(conversationIds);

      client.emit(SERVER_EVENTS.ready, { userId: identity.userId, conversations: conversationIds });
    } catch (error) {
      this.logger.warn(`Rejected messaging socket ${client.id}: ${describe(error)}`);
      // A distinct frame, so a client can tell "your token is stale, refresh it"
      // apart from "the transport is broken" and retry the right way.
      client.emit(SERVER_EVENTS.error, { code: SOCKET_ERROR_CODES.UNAUTHORIZED, message: "Authentication failed" });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    client.data.joinedConversations = undefined;
  }

  // ─── Frames ───────────────────────────────────────────────────────────────

  /**
   * Explicit (re)join. Membership is re-validated rather than read off the
   * connect-time room set, so somebody just added to a thread can join without
   * reconnecting and somebody just removed is refused.
   */
  @SubscribeMessage(CLIENT_EVENTS.joinConversation)
  async handleJoinConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string }
  ): Promise<{ ok: boolean; conversationId?: string } | undefined> {
    return this.frame(client, async (identity) => {
      const conversationId = requireString(body?.conversationId, "conversationId");
      await this.assertMember(identity.userId, conversationId);
      await client.join(conversationRoom(conversationId));
      client.data.joinedConversations?.add(conversationId);
      client.emit(SERVER_EVENTS.joined, { conversationId });
      return { ok: true, conversationId };
    });
  }

  /**
   * Leaving is self-service and needs no membership check: a non-member is not
   * in the room in the first place, so leaving is a no-op rather than a leak.
   */
  @SubscribeMessage(CLIENT_EVENTS.leaveConversation)
  async handleLeaveConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string }
  ): Promise<{ ok: boolean; conversationId?: string } | undefined> {
    return this.frame(client, async () => {
      const conversationId = requireString(body?.conversationId, "conversationId");
      await client.leave(conversationRoom(conversationId));
      client.data.joinedConversations?.delete(conversationId);
      return { ok: true, conversationId };
    });
  }

  /**
   * Send. Authorisation and persistence both belong to the service, so this
   * frame is exactly as restrictive as `POST /conversations/:id/messages`.
   *
   * A rejected send answers the caller's ack and emits an `error` frame, and
   * broadcasts nothing. In particular a non-member learns nothing about whether
   * the conversation exists, because the service denies both cases identically.
   */
  @SubscribeMessage(CLIENT_EVENTS.sendMessage)
  async handleSendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string } & Partial<SendMessageDto>,
    @Ack() ack?: AckFn
  ): Promise<SendMessageResponseDto | undefined> {
    return this.frame(
      client,
      async (identity) => {
        const conversationId = requireString(body?.conversationId, "conversationId");
        return this.messagingService.sendMessage(identity.userId, conversationId, {
          clientMessageId: requireString(body.clientMessageId, "clientMessageId"),
          body: optionalString(body.body, "body"),
          replyToId: optionalString(body.replyToId, "replyToId"),
          type: body.type,
          metadata: body.metadata
        });
      },
      ack
    );
  }

  /**
   * Read high-water mark.
   *
   * Broadcast with `client.to(...)` (everyone *else*), not `server.to(...)`:
   * somebody's read state is private, so it must not be echoed back to the
   * reader, and other participants learn nothing about it either.
   */
  @SubscribeMessage(CLIENT_EVENTS.markRead)
  async handleMarkRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; lastReadMessageId?: string },
    @Ack() ack?: AckFn
  ): Promise<ReadStateResponseDto | undefined> {
    return this.frame(
      client,
      async (identity) => {
        const conversationId = requireString(body?.conversationId, "conversationId");
        const state = await this.messagingService.markRead(identity.userId, conversationId, { lastReadMessageId: optionalString(body.lastReadMessageId, "lastReadMessageId") });
        client.to(conversationRoom(conversationId)).emit(SERVER_EVENTS.readStateChanged, {
          conversationId,
          userId: identity.userId,
          lastReadMessageId: state.lastReadMessageId,
          lastReadAt: state.lastReadAt
        });
        return state;
      },
      ack
    );
  }

  /**
   * Delivery receipt. Unlike read state, the *sender* needs this one: it is what
   * draws the "delivered" tick, so it is broadcast to the rest of the room.
   */
  @SubscribeMessage(CLIENT_EVENTS.markDelivered)
  async handleMarkDelivered(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; lastDeliveredMessageId?: string },
    @Ack() ack?: AckFn
  ): Promise<DeliveryStateResponseDto | undefined> {
    return this.frame(
      client,
      async (identity) => {
        const conversationId = requireString(body?.conversationId, "conversationId");
        const state = await this.messagingService.markDelivered(identity.userId, conversationId, {
          lastDeliveredMessageId: requireString(body.lastDeliveredMessageId, "lastDeliveredMessageId")
        });
        client.to(conversationRoom(conversationId)).emit(SERVER_EVENTS.deliveryStateChanged, {
          conversationId,
          userId: identity.userId,
          lastDeliveredMessageId: state.lastDeliveredMessageId,
          receiptsUpdated: state.receiptsUpdated
        });
        return state;
      },
      ack
    );
  }

  /**
   * Ephemeral typing indicator. Broadcast only — nothing is persisted, because a
   * typing flag is worthless by the time it could be replayed. Membership is
   * re-validated because this frame names a conversation and emits to a room.
   */
  @SubscribeMessage(CLIENT_EVENTS.typing)
  async handleTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; isTyping?: boolean }
  ): Promise<{ conversationId: string; isTyping: boolean } | undefined> {
    return this.frame(client, async (identity) => {
      const conversationId = requireString(body?.conversationId, "conversationId");
      await this.assertMember(identity.userId, conversationId);

      const isTyping = body.isTyping === true;
      client.to(conversationRoom(conversationId)).emit(SERVER_EVENTS.typing, { conversationId, userId: identity.userId, name: identity.name, isTyping });
      return { conversationId, isTyping };
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Runs one frame handler behind the identity gate and the error contract.
   *
   * Centralising it means no handler can forget either: `identityOf` throws for
   * an unauthenticated socket, and every thrown error — a bad payload, a denied
   * membership, a provider fault — reaches the client as one `error` frame and
   * one ack with the same code, instead of disappearing into Nest's WS
   * exception handler where the client would simply time out.
   */
  private async frame<T>(client: AuthedSocket, handler: (identity: SocketIdentity) => Promise<T>, ack?: AckFn): Promise<T | undefined> {
    try {
      const result = await handler(this.identityOf(client));
      ack?.({ ok: true, data: result });
      return result;
    } catch (error) {
      const response = { ok: false as const, code: errorCode(error), error: describe(error) };
      ack?.(response);
      client.emit(SERVER_EVENTS.error, { code: response.code, message: response.error });
      if (response.code === SOCKET_ERROR_CODES.INTERNAL) this.logger.error(`Messaging frame failed: ${describe(error)}`);
      return undefined;
    }
  }

  /**
   * The identity gate. Throws for an unauthenticated socket rather than
   * returning `null`, so a missing guard becomes a thrown error rather than a
   * data leak.
   */
  private identityOf(client: AuthedSocket): SocketIdentity {
    const identity = client.data?.identity;
    if (!identity) throw new UnauthorizedSocketError();
    return identity;
  }

  /**
   * Re-validates membership for a frame that names a conversation. See the class
   * comment for why the connect-time room set is not sufficient.
   */
  private async assertMember(userId: string, conversationId: string): Promise<void> {
    await this.messagingService.requireMembership(userId, conversationId);
  }

  /**
   * Fans a stored message out to the conversation room.
   *
   * `server.to(room)` (rather than a per-socket emit) is what the redis-adapter
   * intercepts, so this single call reaches sockets held by other instances
   * without any instance-to-instance code here.
   */
  private broadcastMessage(event: MessageStoredEvent): void {
    if (!this.server) return;
    const payload: { conversationId: string; message: MessageResponseDto } = { conversationId: event.conversationId, message: event.message };
    this.server.to(conversationRoom(event.conversationId)).emit(SERVER_EVENTS.messageCreated, payload);
  }
}

/** Thrown by {@link MessagingGateway.identityOf}; never escapes `frame`. */
class UnauthorizedSocketError extends Error {
  readonly code = SOCKET_ERROR_CODES.UNAUTHORIZED;
  constructor() {
    super("Socket is not authenticated");
  }
}

// ─── Frame payload guards ────────────────────────────────────────────────────

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new BadFrameError(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new BadFrameError(`${field} must be a string`);
  return value;
}

/** A malformed or missing field in a client frame. */
class BadFrameError extends Error {
  readonly code = SOCKET_ERROR_CODES.BAD_REQUEST;
}

function errorCode(error: unknown): string {
  if (error instanceof UnauthorizedSocketError) return error.code;
  if (error instanceof BadFrameError) return error.code;
  // Mirrors the HTTP surface exactly: a non-member is a 404, and reporting it as
  // `not_a_participant` to the socket leaks no more than the 404 did.
  if (error instanceof MessagingAccessException) return SOCKET_ERROR_CODES.NOT_A_PARTICIPANT;
  const status = (error as { status?: number }).status;
  if (status === 404) return SOCKET_ERROR_CODES.NOT_A_PARTICIPANT;
  if (status === 403) return SOCKET_ERROR_CODES.FORBIDDEN;
  if (status === 400) return SOCKET_ERROR_CODES.BAD_REQUEST;
  return SOCKET_ERROR_CODES.INTERNAL;
}

function describe(error: unknown): string {
  const message = (error as { response?: { message?: string | string[] } }).response?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join(", ");
  return error instanceof Error ? error.message : "Request failed";
}
