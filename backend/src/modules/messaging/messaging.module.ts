import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "src/modules/auth/auth.module";
import { User } from "src/modules/users/entities/user.entity";
import { Conversation, ConversationParticipant, Message, MessageReceipt } from "./entities";
import { MessagingController } from "./messaging.controller";
import { MessagingGateway } from "./messaging.gateway";
import { MessagingRealtimeBus } from "./messaging-realtime.bus";
import { MessagingService } from "./messaging.service";

/**
 * MESSAGING MODULE
 * ---------------------------------------------------------------------------
 * Conversations, participants, messages, read/delivery state, and a Socket.IO
 * gateway — plus the one domain-event producer that is not a workout.
 *
 * The dependency shape is the interesting part:
 *
 *   - It depends on `AuthModule` **only** for `JwtModule`, so the gateway can
 *     verify an access token with the same secret the HTTP API uses. There is
 *     exactly one authority on token validity and the socket transport reuses it
 *     rather than introducing a second signing path. (Registering a second
 *     `JwtModule` here would be actively wrong: a secret-less one would shadow
 *     the configured one and silently fail every handshake.)
 *   - It depends on `DomainEventPublisher` — the abstraction in
 *     `common/events`, not the outbox implementation. `MessagingService` knows a
 *     message should be announced and nothing about how it is delivered;
 *     `NotificationsModule` supplies the implementation and depends on nothing
 *     here except a read-only participant repo. The arrow is
 *     `messaging ──▶ common/events ◀── notifications`, so the graph is acyclic
 *     and no producer imports notification code.
 *   - It does NOT import `NotificationsModule`. The only notification-shaped
 *     thing in this module is one event type constant in that shared contract.
 *
 * `MessagingIoAdapter` — which attaches the Socket.IO redis-adapter for
 * cross-instance fan-out — is installed once in `main.ts`, because Nest only
 * honours a WebSocket adapter set on the application itself.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Conversation, ConversationParticipant, Message, MessageReceipt, User]), AuthModule],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway, MessagingRealtimeBus],
  exports: [MessagingService, MessagingRealtimeBus]
})
export class MessagingModule {}
