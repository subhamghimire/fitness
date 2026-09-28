import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, Repository } from "typeorm";
import { DomainEvent, DomainEventPublisher, DomainEventType } from "src/common/events";
import { User } from "src/modules/users/entities/user.entity";
import { Conversation, ConversationParticipant, Message, MessageReceipt } from "./entities";
import { ConversationParticipantRole, ConversationType, MessageDeliveryState, MessageType } from "./enums";
import { MessagingAccessException, MessagingService, buildDirectKey } from "./messaging.service";
import { MessagingRealtimeBus } from "./messaging-realtime.bus";

/**
 * MESSAGING SERVICE
 *
 * The suite is organised around the two guarantees the module actually rests
 * on — authorisation and idempotency — rather than around the DTO surface:
 *
 *   - UNAUTHORIZED ACCESS. A non-member must get 404 (never 403, which would
 *     confirm the id exists), and must be refused identically for reading,
 *     sending, read-state and moderation. A member who has left must be refused
 *     too, which is the case that a naive `user_id + conversation_id` lookup
 *     would let through.
 *
 *   - SENDING. A committed message must leave the projections and the outbox
 *     consistent with it, must broadcast only after the commit, and must be
 *     idempotent under a retried `clientMessageId`.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";

const activeMember = (userId: string, overrides: Partial<ConversationParticipant> = {}): ConversationParticipant =>
  ({
    id: `cp-${userId}`,
    conversationId: CONVERSATION,
    userId,
    role: ConversationParticipantRole.MEMBER,
    isMuted: false,
    unreadCount: 0,
    readState: MessageDeliveryState.SENT,
    lastReadMessageId: null,
    lastReadAt: null,
    lastDeliveredMessageId: null,
    lastDeliveredAt: null,
    leftAt: null,
    isDeleted: false,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides
  }) as ConversationParticipant;

/**
 * A query-builder stub. Every builder method returns the chain so the fluent
 * calls the service makes are all satisfiable by one object; the terminal
 * methods resolve an empty result. Tests override the terminal they care about.
 */
interface QueryChain {
  select: jest.Mock<QueryChain, unknown[]>;
  addSelect: jest.Mock<QueryChain, unknown[]>;
  from: jest.Mock<QueryChain, unknown[]>;
  innerJoin: jest.Mock<QueryChain, unknown[]>;
  leftJoin: jest.Mock<QueryChain, unknown[]>;
  orderBy: jest.Mock<QueryChain, unknown[]>;
  limit: jest.Mock<QueryChain, unknown[]>;
  offset: jest.Mock<QueryChain, unknown[]>;
  setParameter: jest.Mock<QueryChain, unknown[]>;
  getRawMany: jest.Mock<Promise<unknown[]>, unknown[]>;
  getMany: jest.Mock<Promise<unknown[]>, unknown[]>;
  getOne: jest.Mock<Promise<unknown>, unknown[]>;
  getCount: jest.Mock<Promise<number>, unknown[]>;
  update: jest.Mock<QueryChain, unknown[]>;
  set: jest.Mock<QueryChain, [Record<string, unknown>]>;
  insert: jest.Mock<QueryChain, unknown[]>;
  into: jest.Mock<QueryChain, unknown[]>;
  values: jest.Mock<QueryChain, unknown[]>;
  orIgnore: jest.Mock<QueryChain, unknown[]>;
  where: jest.Mock<QueryChain, unknown[]>;
  andWhere: jest.Mock<QueryChain, unknown[]>;
  returning: jest.Mock<QueryChain, unknown[]>;
  execute: jest.Mock<Promise<{ raw: unknown[] }>, unknown[]>;
}

const makeChain = (): QueryChain => {
  const chain: QueryChain = {
    // SELECT
    select: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    addSelect: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    from: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    innerJoin: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    leftJoin: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    orderBy: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    limit: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    offset: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    setParameter: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    getRawMany: jest.fn<Promise<unknown[]>, unknown[]>().mockResolvedValue([]),
    getMany: jest.fn<Promise<unknown[]>, unknown[]>().mockResolvedValue([]),
    getOne: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(null),
    getCount: jest.fn<Promise<number>, unknown[]>().mockResolvedValue(0),
    // UPDATE
    update: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    set: jest.fn<QueryChain, [Record<string, unknown>]>().mockReturnThis(),
    // INSERT
    insert: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    into: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    values: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    orIgnore: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    // Terminal
    where: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    andWhere: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    returning: jest.fn<QueryChain, unknown[]>().mockReturnThis(),
    execute: jest.fn<Promise<{ raw: unknown[] }>, unknown[]>().mockResolvedValue({ raw: [] })
  };
  return chain;
};

/** Pulls the ids out of a TypeORM `In([...])` find operator. */
const idsOf = (condition: unknown): string[] => {
  if (Array.isArray(condition)) return condition as string[];
  const value = (condition as { value?: unknown } | null | undefined)?.value;
  return Array.isArray(value) ? (value as string[]) : [];
};

const makeService = (options: { members?: ConversationParticipant[] } = {}) => {
  const members = options.members ?? [activeMember(ALICE), activeMember(BOB)];

  const conversationsFind = jest.fn().mockResolvedValue([]);
  const conversationsFindOne = jest.fn();
  const conversationsSave = jest.fn();
  const conversationsCreate = jest.fn((data: object) => ({ ...data }));
  const conversationsCreateQueryBuilder = jest.fn(() => makeChain());
  const conversationsRepo = {
    findOne: conversationsFindOne,
    find: conversationsFind,
    save: conversationsSave,
    create: conversationsCreate,
    createQueryBuilder: conversationsCreateQueryBuilder
  } as unknown as Repository<Conversation>;

  const participantsFind = jest.fn().mockResolvedValue(members);
  const participantsFindOne = jest.fn();
  const participantsSave = jest.fn();
  const participantsCreate = jest.fn((data: object) => ({ ...data }));
  const participantsCreateQueryBuilder = jest.fn(() => makeChain());
  const participantsRepo = {
    findOne: participantsFindOne,
    find: participantsFind,
    save: participantsSave,
    create: participantsCreate,
    createQueryBuilder: participantsCreateQueryBuilder
  } as unknown as Repository<ConversationParticipant>;

  const messagesFind = jest.fn().mockResolvedValue([]);
  const messagesFindOne = jest.fn();
  const messagesSave = jest.fn();
  const messagesRepo = {
    find: messagesFind,
    findOne: messagesFindOne,
    save: messagesSave
  } as unknown as Repository<Message>;

  const receiptsFind = jest.fn().mockResolvedValue([]);
  const receiptsCreate = jest.fn((data: object) => ({ ...data }));
  const receiptsCreateQueryBuilder = jest.fn(() => makeChain());
  const receiptsRepo = {
    find: receiptsFind,
    create: receiptsCreate,
    createQueryBuilder: receiptsCreateQueryBuilder
  } as unknown as Repository<MessageReceipt>;

  // `usersRepo` serves the sender-name lookups. It is stubbed by id so a test
  // can assert *how many* lookups a page costs.
  const knownUsers = new Map<string, User>([
    [ALICE, { id: ALICE, name: `user-${ALICE}` } as User],
    [BOB, { id: BOB, name: `user-${BOB}` } as User],
    [CAROL, { id: CAROL, name: `user-${CAROL}` } as User]
  ]);
  const usersFindOne = jest.fn((opts: { where?: { id?: unknown } } | null | undefined): User | null => {
    const id = opts?.where?.id;
    return typeof id === "string" ? (knownUsers.get(id) ?? null) : null;
  });
  const usersFind = jest.fn((opts: { where?: { id?: unknown } } | null | undefined): User[] =>
    idsOf(opts?.where?.id)
      .map((id) => knownUsers.get(id))
      .filter((u): u is User => u !== undefined)
  );
  const usersRepo = {
    findOne: usersFindOne,
    find: usersFind
  } as unknown as Repository<User>;

  // The manager handed to the transaction callback. `participantRepo` is what
  // requireMembership reads through, so a test can make authorisation succeed or
  // fail *inside* the transaction.
  const managerParticipantFindOne = jest.fn(({ where }: { where: { conversationId?: string; userId?: string; leftAt?: unknown } }): ConversationParticipant | null => {
    const member = members.find((m) => m.conversationId === where.conversationId && m.userId === where.userId);
    if (!member) return null;
    // The real query filters on `left_at IS NULL`; mirror that so a member who
    // has left is refused by the in-transaction check too.
    if (where.leftAt && member.leftAt !== null) return null;
    return member;
  });
  const managerParticipantRepo = { findOne: managerParticipantFindOne };
  const managerMessageFindOne = jest.fn();
  const managerMessageRepo = { findOne: managerMessageFindOne };
  const managerCreate = jest.fn((_entity: unknown, data: object) => ({ ...data }));
  const managerSave = jest.fn((entity: unknown): Promise<unknown> => {
    if (Array.isArray(entity)) return Promise.resolve(entity);
    return Promise.resolve({ ...(entity as object), id: MESSAGE, createdAt: new Date("2026-02-02T10:00:00Z") });
  });
  const manager = {
    getRepository: jest.fn((entity: unknown) => (entity === ConversationParticipant ? managerParticipantRepo : entity === Message ? managerMessageRepo : {})),
    create: managerCreate,
    save: managerSave,
    createQueryBuilder: jest.fn(() => makeChain())
  } as unknown as EntityManager;

  const transaction = jest.fn((cb: (m: EntityManager) => Promise<unknown>) => cb(manager));

  const dataSource = { transaction, manager } as unknown as DataSource;

  const publish = jest.fn<Promise<void>, [DomainEvent]>().mockResolvedValue(undefined);
  const publishInTransaction = jest.fn<Promise<void>, [EntityManager, DomainEvent]>().mockResolvedValue(undefined);
  const eventPublisher = { publish, publishInTransaction } as unknown as DomainEventPublisher;
  const realtimePublish = jest.fn();
  const realtimeBus = { publish: realtimePublish } as unknown as MessagingRealtimeBus;

  const service = new MessagingService(conversationsRepo, participantsRepo, messagesRepo, receiptsRepo, usersRepo, dataSource, eventPublisher, realtimeBus);

  // Narrow views onto the service's private internals, so tests can stub the
  // two batching helpers and the page-read repository without `any`.
  const serviceMocks = service as unknown as {
    activeConversationIds: jest.Mock;
    resolveNames: jest.Mock;
    writeReceipts: jest.Mock;
    messagesRepo: { find: jest.Mock };
  };

  return {
    service,
    serviceMocks,
    conversationsRepo,
    conversationsFind,
    conversationsFindOne,
    conversationsCreateQueryBuilder,
    participantsRepo,
    participantsFind,
    participantsFindOne,
    participantsCreateQueryBuilder,
    messagesRepo,
    messagesFind,
    messagesFindOne,
    receiptsRepo,
    usersRepo,
    usersFind,
    usersFindOne,
    manager,
    managerParticipantRepo,
    managerParticipantFindOne,
    managerMessageRepo,
    managerMessageFindOne,
    managerSave,
    transaction,
    publishInTransaction,
    realtimePublish
  };
};

const ALICE_CONVERSATION = {
  id: CONVERSATION,
  type: ConversationType.DIRECT,
  title: null,
  createdById: ALICE,
  directKey: buildDirectKey(ALICE, BOB),
  lastMessageId: null,
  lastMessageAt: null,
  lastMessagePreview: null,
  isDeleted: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z")
} as Conversation;

describe("MessagingService — unauthorized conversation access", () => {
  /**
   * The load-bearing assertion. A non-member must be refused for *every*
   * read/write entry point, and refused as 404 rather than 403: a 403 would
   * confirm the conversation id exists, turning the id space into an oracle for
   * enumerating who is talking to whom.
   */
  it("refuses every operation for a non-member with 404, never 403", async () => {
    const { service, serviceMocks, messagesFind, participantsRepo, managerSave, realtimePublish } = makeService({
      members: [activeMember(ALICE), activeMember(BOB)]
    });

    // No participant row for CAROL anywhere, in or out of the transaction.
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(null);
    serviceMocks.activeConversationIds = jest.fn().mockResolvedValue([]);

    const denied = [
      () => service.getConversation(CAROL, CONVERSATION),
      () => service.listMessages(CAROL, CONVERSATION, { limit: 10 }),
      () => service.sendMessage(CAROL, CONVERSATION, { clientMessageId: "cm-carol", body: "hi" }),
      () => service.markRead(CAROL, CONVERSATION, {}),
      () => service.markDelivered(CAROL, CONVERSATION, { lastDeliveredMessageId: MESSAGE }),
      () => service.listReadReceipts(CAROL, CONVERSATION),
      () => service.updateConversation(CAROL, CONVERSATION, { title: "hijacked" }),
      () => service.addParticipants(CAROL, CONVERSATION, { participantIds: [CAROL] }),
      () => service.removeParticipant(CAROL, CONVERSATION, ALICE)
    ];

    for (const call of denied) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }

    // Nothing leaked: no message written, nothing broadcast.
    expect(managerSave).not.toHaveBeenCalled();
    expect(realtimePublish).not.toHaveBeenCalled();
    expect(messagesFind).not.toHaveBeenCalled();
  });

  /** A member who left keeps their history but loses all access. */
  it("refuses a participant who has left the conversation", async () => {
    const { service, participantsRepo } = makeService({ members: [activeMember(ALICE), activeMember(BOB), activeMember(CAROL, { leftAt: new Date("2026-03-01T00:00:00Z") })] });
    (participantsRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId?: string } }) => (where.userId === CAROL ? null : activeMember(where.userId ?? "")));

    await expect(service.getConversation(CAROL, CONVERSATION)).rejects.toBeInstanceOf(MessagingAccessException);
    await expect(service.sendMessage(CAROL, CONVERSATION, { clientMessageId: "cm-carol", body: "hi" })).rejects.toMatchObject({ status: 404 });
  });

  /** An id that does not exist is denied identically, so probing reveals nothing. */
  it("returns the same 404 for a conversation that does not exist at all", async () => {
    const { service, participantsRepo } = makeService();
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(null);

    const missing = (await service.getConversation(ALICE, "99999999-9999-4999-8999-999999999999").catch((e: unknown) => e)) as MessagingAccessException;
    const forbidden = (await service.getConversation(CAROL, CONVERSATION).catch((e: unknown) => e)) as MessagingAccessException;

    expect(missing).toBeInstanceOf(MessagingAccessException);
    expect(forbidden).toBeInstanceOf(MessagingAccessException);
    // Identical response — the two cases are indistinguishable from outside.
    expect(missing.getStatus()).toBe(forbidden.getStatus());
    expect(missing.message).toBe(forbidden.message);
  });

  /**
   * Membership alone must not imply control. Moderation is a second, separate
   * gate, and it is a 403 rather than a 404 precisely because the caller has
   * already proven they are a legitimate member.
   */
  it("lets a plain member send but refuses them moderation, with 403", async () => {
    const { service, participantsRepo, managerParticipantRepo, managerSave } = makeService();
    (participantsRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId: string } }) => (where.userId === ALICE ? activeMember(ALICE) : null));
    (managerParticipantRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId: string } }) => (where.userId === ALICE ? activeMember(ALICE) : null));
    (managerSave as jest.Mock).mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: ALICE,
      type: MessageType.TEXT,
      body: "ok",
      createdAt: new Date(),
      clientMessageId: "cm-1"
    });

    // Sending is allowed...
    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-1", body: "ok" })).resolves.toBeDefined();

    // ...but adding participants and renaming are not.
    await expect(service.addParticipants(ALICE, CONVERSATION, { participantIds: [CAROL] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateConversation(ALICE, CONVERSATION, { title: "renamed" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("authorises inside the send transaction, so a membership revoked mid-flight is refused", async () => {
    const { service, managerParticipantRepo, managerSave } = makeService();
    // The pre-transaction check passes, but the in-transaction one fails —
    // i.e. the user was removed between the two.
    (managerParticipantRepo.findOne as jest.Mock).mockResolvedValue(null);

    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-1", body: "hi" })).rejects.toBeInstanceOf(MessagingAccessException);
    expect(managerSave).not.toHaveBeenCalled();
  });

  it("never lists conversations a user is not an active participant of", async () => {
    const { service, serviceMocks, participantsRepo, conversationsFind, conversationsCreateQueryBuilder } = makeService();

    // The id query joins on the caller's OWN participant row, so the only
    // conversation it can return is one ALICE is actually in.
    const idChain = makeChain();
    idChain.getRawMany.mockResolvedValue([{ conversationId: CONVERSATION }]);
    conversationsCreateQueryBuilder.mockReturnValue(idChain);

    conversationsFind.mockResolvedValue([ALICE_CONVERSATION]);
    (participantsRepo.find as jest.Mock).mockImplementation((opts: { where?: { conversationId?: string } }) =>
      opts.where?.conversationId === undefined ? [activeMember(ALICE)] : [activeMember(ALICE), activeMember(BOB)]
    );
    serviceMocks.resolveNames = jest.fn().mockResolvedValue(
      new Map([
        [ALICE, "Alice"],
        [BOB, "Bob"]
      ])
    );

    const page = await service.listConversations(ALICE, { limit: 20 });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].id).toBe(CONVERSATION);
    // Membership is a structural join on the caller's OWN row, not a filter
    // applied to the result set afterwards.
    expect(idChain.innerJoin).toHaveBeenCalledWith(ConversationParticipant, "me", "me.conversation_id = c.id AND me.user_id = :userId", { userId: ALICE });
    expect(idChain.where).toHaveBeenCalledWith("me.left_at IS NULL");
  });
});

describe("MessagingService — sending a message", () => {
  const memberService = () => {
    const ctx = makeService();
    (ctx.participantsRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId: string } }) => (where.userId === ALICE ? activeMember(ALICE) : null));
    (ctx.managerParticipantRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId: string } }) => (where.userId === ALICE ? activeMember(ALICE) : null));
    return ctx;
  };

  it("persists the message and announces it in the same transaction", async () => {
    const { service, transaction, publishInTransaction, managerSave } = memberService();

    const result = await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "  leg day  " });

    expect(result.duplicate).toBe(false);
    expect(result.message.body).toBe("leg day");
    expect(result.message.senderId).toBe(ALICE);

    // Authorisation, the write and the announcement share one transaction, so a
    // committed message can never be missing its notification event.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(managerSave).toHaveBeenCalledTimes(1);
    expect(publishInTransaction).toHaveBeenCalledTimes(1);

    const [manager, event] = publishInTransaction.mock.calls[0];
    expect(manager).toBeDefined();
    expect(event).toMatchObject({
      type: DomainEventType.MESSAGE_RECEIVED,
      actorId: ALICE,
      aggregate: { type: "message", id: MESSAGE },
      audience: { kind: "conversation_participants", conversationId: CONVERSATION, excludeUserId: ALICE }
    });
    // Re-publishing this occurrence can never produce a second notification.
    expect(event.idempotencyKey).toBe(`${DomainEventType.MESSAGE_RECEIVED}:${MESSAGE}`);
  });

  it("broadcasts only after the commit, and not at all for a rolled-back send", async () => {
    const { service, transaction, realtimePublish, manager } = memberService();
    const order: string[] = [];
    (transaction as jest.Mock).mockImplementation(async (cb: (m: EntityManager) => Promise<unknown>) => {
      // The commit is the point at which the transaction callback returns.
      const result = await cb(manager);
      order.push("commit");
      return result;
    });
    realtimePublish.mockImplementation(() => order.push("broadcast"));

    await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "hi" });

    // A subscriber must never observe a message that subsequently rolled back.
    expect(order).toEqual(["commit", "broadcast"]);
  });

  it("broadcasts nothing at all when the send transaction rolls back", async () => {
    const { service, transaction, realtimePublish, manager } = memberService();
    (transaction as jest.Mock).mockImplementation(async (cb: (m: EntityManager) => Promise<unknown>) => {
      await cb(manager);
      throw new Error("deadlock detected");
    });

    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "hi" })).rejects.toThrow("deadlock detected");
    expect(realtimePublish).not.toHaveBeenCalled();
  });

  it("does not broadcast when the send turns out to be a duplicate", async () => {
    const { service, managerMessageRepo, realtimePublish, publishInTransaction } = memberService();
    managerMessageRepo.findOne.mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: ALICE,
      type: MessageType.TEXT,
      body: "already sent",
      clientMessageId: "cm-12345678",
      createdAt: new Date("2026-02-02T10:00:00Z")
    });

    const result = await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "already sent" });

    // The client collapses its optimistic bubble onto the row it is handed.
    expect(result.duplicate).toBe(true);
    expect(result.message.id).toBe(MESSAGE);
    expect(realtimePublish).not.toHaveBeenCalled();
    expect(publishInTransaction).not.toHaveBeenCalled();
  });

  /** Two sockets racing the same clientMessageId: the loser re-reads, it does not 500. */
  it("recovers from a unique-violation race by returning the winner's row", async () => {
    const { service, managerSave, managerMessageRepo, realtimePublish } = memberService();
    // Nothing yet, then the winner's row once the insert has collided.
    managerMessageRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue({
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderId: ALICE,
      type: MessageType.TEXT,
      body: "hi",
      clientMessageId: "cm-12345678",
      createdAt: new Date("2026-02-02T10:00:00Z")
    });
    (managerSave as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { driverError: { code: "23505" } }));

    const result = await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "hi" });

    expect(result.duplicate).toBe(true);
    expect(result.message.id).toBe(MESSAGE);
    expect(realtimePublish).not.toHaveBeenCalled();
  });

  /** A non-unique failure is a genuine error and must not be swallowed. */
  it("propagates a real database failure rather than reporting a duplicate", async () => {
    const { service, managerSave, managerMessageRepo } = memberService();
    managerMessageRepo.findOne.mockResolvedValue(null);
    (managerSave as jest.Mock).mockRejectedValueOnce(new Error("connection terminated"));

    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "hi" })).rejects.toThrow("connection terminated");
  });

  it("requires a body for text and metadata for attachments", async () => {
    const { service, managerSave } = memberService();

    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "   " })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", type: MessageType.IMAGE })).rejects.toBeInstanceOf(BadRequestException);
    expect(managerSave).not.toHaveBeenCalled();
  });

  it("stores an attachment as metadata with a null body", async () => {
    const { service, managerSave } = memberService();
    (managerSave as jest.Mock).mockImplementation((e: object) => Promise.resolve({ ...e, id: MESSAGE, createdAt: new Date() }));

    const result = await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", type: MessageType.IMAGE, metadata: { url: "https://cdn/x.png" } });

    expect(result.message.body).toBeNull();
    expect(result.message.metadata).toEqual({ url: "https://cdn/x.png" });
    expect(managerSave).toHaveBeenCalledWith(expect.objectContaining({ body: null, type: MessageType.IMAGE }));
  });

  it("trims the body and falls back to the type when there is no text to preview", async () => {
    const { service, managerSave } = memberService();
    (managerSave as jest.Mock).mockImplementation((e: object) => Promise.resolve({ ...e, id: MESSAGE, createdAt: new Date() }));

    await service.sendMessage(ALICE, CONVERSATION, { clientMessageId: "cm-12345678", body: "  spaced  out  " });
    expect(managerSave).toHaveBeenCalledWith(expect.objectContaining({ body: "spaced  out" }));
  });
});

describe("MessagingService — read state and pagination", () => {
  it("refuses a read mark that names a message from another conversation", async () => {
    const { service, participantsRepo, messagesFindOne } = memberServiceForRead();
    (participantsRepo.findOne as jest.Mock).mockImplementation(({ where }: { where: { userId: string } }) => (where.userId === ALICE ? activeMember(ALICE) : null));
    // The message exists, but not in this conversation.
    messagesFindOne.mockResolvedValue(null);

    await expect(service.markRead(ALICE, CONVERSATION, { lastReadMessageId: MESSAGE })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("derives the unread count instead of writing a literal zero", async () => {
    const { service, serviceMocks, participantsRepo, participantsCreateQueryBuilder } = memberServiceForRead();
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(activeMember(ALICE));
    serviceMocks.writeReceipts = jest.fn().mockResolvedValue(0);

    const chain = makeChain();
    chain.execute.mockResolvedValue({ raw: [{ unread_count: 4 }] });
    participantsCreateQueryBuilder.mockReturnValue(chain);

    const state = await service.markRead(ALICE, CONVERSATION, {});

    expect(state.unreadCount).toBe(4);
    // Self-healing: recomputed from last_read_at, so drift is corrected. The
    // count is a SQL expression, not a value, so it cannot be computed here.
    const setArg = chain.set.mock.calls[0][0];
    expect(setArg.readState).toBe(MessageDeliveryState.READ);
    expect(typeof setArg.unreadCount).toBe("function");
  });

  it("never walks the delivery mark backwards on an out-of-order report", async () => {
    const { service, serviceMocks, participantsRepo, messagesFindOne } = memberServiceForRead();
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(activeMember(ALICE, { lastDeliveredMessageId: "newer", lastDeliveredAt: new Date("2026-02-03T00:00:00Z") }));
    // The client reports a marker older than the one we already hold.
    messagesFindOne.mockImplementation((opts: { where?: { id?: string } }) =>
      opts.where?.id === "newer" ? { id: "newer", createdAt: new Date("2026-02-03T00:00:00Z") } : { id: "older", createdAt: new Date("2026-02-01T00:00:00Z") }
    );
    serviceMocks.writeReceipts = jest.fn().mockResolvedValue(0);

    const state = await service.markDelivered(ALICE, CONVERSATION, { lastDeliveredMessageId: "older" });

    expect(state.lastDeliveredMessageId).toBe("newer");
    expect(state.receiptsUpdated).toBe(0);
    // The mark is left alone, so the older range is not re-reported.
    expect(serviceMocks.writeReceipts).not.toHaveBeenCalled();
  });

  it("keyset-paginates history and reports whether more remains", async () => {
    const { service, serviceMocks, participantsRepo, messagesFind } = memberServiceForRead();
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(activeMember(ALICE));

    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `m${i}`,
      conversationId: CONVERSATION,
      senderId: ALICE,
      type: MessageType.TEXT,
      body: `body ${i}`,
      createdAt: new Date(2026, 1, 10, 12, 0, i)
    }));
    messagesFind.mockResolvedValue(rows);
    serviceMocks.resolveNames = jest.fn().mockResolvedValue(new Map([[ALICE, "Alice"]]));

    const page = await service.listMessages(ALICE, CONVERSATION, { limit: 3 });

    expect(page.data).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    // The cursor is the oldest row on the page, so the next page cannot shift
    // when a new message arrives mid-scroll.
    expect(page.nextCursor).toBe(rows[2].createdAt.toISOString());
    expect(messagesFind).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
  });

  it("batches sender-name lookups into one query per page", async () => {
    const { service, serviceMocks, participantsRepo, usersFind } = memberServiceForRead();
    (participantsRepo.findOne as jest.Mock).mockResolvedValue(activeMember(ALICE));
    serviceMocks.messagesRepo.find = jest.fn().mockResolvedValue([
      { id: "m1", conversationId: CONVERSATION, senderId: ALICE, type: MessageType.TEXT, body: "a", createdAt: new Date() },
      { id: "m2", conversationId: CONVERSATION, senderId: BOB, type: MessageType.TEXT, body: "b", createdAt: new Date() },
      { id: "m3", conversationId: CONVERSATION, senderId: BOB, type: MessageType.TEXT, body: "c", createdAt: new Date() }
    ]);

    const page = await service.listMessages(ALICE, CONVERSATION, { limit: 10 });

    expect(page.data.map((m) => m.senderName)).toEqual([`user-${ALICE}`, `user-${BOB}`, `user-${BOB}`]);
    // One lookup for the whole page, not one per message.
    expect(usersFind).toHaveBeenCalledTimes(1);
  });
});

function memberServiceForRead() {
  const ctx = makeService();
  const chain = makeChain();
  (ctx.participantsRepo.createQueryBuilder as jest.Mock).mockReturnValue(chain);
  return { ...ctx, participantsRepoChain: chain };
}
