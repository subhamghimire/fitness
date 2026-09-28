import { EntityManager } from "typeorm";
import { DomainEvent } from "./domain-event";

/**
 * DOMAIN EVENT PUBLISHER
 *
 * The single seam a producing module uses to announce a domain fact. Two entry
 * points, and the difference is the whole point of this abstraction:
 *
 *   `publishInTransaction(manager, event)`
 *       Called from *inside* the business transaction. Writes one outbox row
 *       using the caller's `EntityManager`, so "the workout was saved" and
 *       "the workout-completed event exists" commit or roll back together —
 *       there is no crash window where a committed workout is silently never
 *       announced, and no phantom event for a rolled-back workout.
 *
 *       This performs exactly one INSERT on the same connection. It cannot
 *       fail for a *notification* reason: there is no provider call, no HTTP
 *       request, no queue round-trip and no template rendering here. If this
 *       insert fails, the database is unavailable and the business write should
 *       fail with it.
 *
 *   `publish(event)`
 *       For producers whose business write is already committed (coach-client
 *       invitations, program assignments, messages). The event is enqueued on
 *       the same transactional outbox, then the error is swallowed and logged.
 *       A notification provider being down must never turn a successful
 *       invitation into a 500 for the user.
 *
 * Either way, no producer ever touches a notification, a channel, a preference
 * or a provider — only this contract.
 */
export abstract class DomainEventPublisher {
  /** Persists the event on the caller's transaction. Throws on DB failure. */
  abstract publishInTransaction(manager: EntityManager, event: DomainEvent): Promise<void>;

  /** Persists the event on its own connection. Never rejects. */
  abstract publish(event: DomainEvent): Promise<void>;
}
