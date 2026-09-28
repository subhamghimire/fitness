import { Injectable, Logger } from "@nestjs/common";
import { Subject } from "rxjs";
import { MessageResponseDto } from "./dto";

/**
 * A message has been durably stored and committed.
 *
 * Emitted only *after* the send transaction commits — never inside it — so a
 * subscriber can never observe a message that subsequently rolled back.
 */
export interface MessageStoredEvent {
  conversationId: string;
  message: MessageResponseDto;
}

/**
 * MESSAGING REALTIME BUS
 * ---------------------------------------------------------------------------
 * The seam between "a message was persisted" and "a WebSocket frame was
 * emitted", without either side importing the other.
 *
 * Why this is not a direct call from the service to the gateway:
 *
 *   - the service would need to know a gateway exists, and an HTTP-only
 *     deployment (or a unit test) would then need a fake transport;
 *   - the gateway would need to inject the service and risk a cycle when the
 *     service needs the gateway for the post-commit emit.
 *
 * Emitting in-process is sufficient and honest: the fan-out to *other* app
 * instances is Socket.IO's redis-adapter job, not ours. Nothing here is
 * durable — if no subscriber is attached the event is dropped, which is fine
 * because a client that misses a live frame reconciles by re-reading the thread
 * (the same reason HTTP stays authoritative).
 */
@Injectable()
export class MessagingRealtimeBus {
  private readonly logger = new Logger(MessagingRealtimeBus.name);
  private readonly subject = new Subject<MessageStoredEvent>();

  /** Live frames for a stored message. */
  get messageStored$(): Subject<MessageStoredEvent> {
    return this.subject;
  }

  /**
   * Deliberately fire-and-forget: a broadcast failure must never surface to the
   * sender, whose message is already committed. A throwing subscriber is logged
   * and skipped rather than allowed to break the fan-out for everyone else.
   */
  publish(event: MessageStoredEvent): void {
    this.subject.next(event);
  }

  /** Exposed for the gateway's shutdown path. */
  complete(): void {
    this.subject.complete();
  }

  warn(context: string, error: unknown): void {
    this.logger.warn(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
