import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/**
 * PROCESSED WEBHOOK EVENT — the idempotency ledger for provider callbacks.
 *
 * `(provider, eventId)` is unique: the first delivery inserts, every replay
 * hits the constraint and is acknowledged without touching business state.
 * This is what makes "a repeated webhook must not create duplicate orders,
 * payments or entitlements" true even when two deliveries race — the loser
 * gets a 23505 and returns `{ deduped: true }`.
 *
 * Deliberately NOT soft-deletable and NOT updatable: a consumed event id must
 * stay consumed forever, otherwise a replay after a delete would double-apply.
 */
@Entity({ name: "marketplace_processed_webhook_events" })
@Unique("uk_webhook_provider_event", ["provider", "eventId"])
export class ProcessedWebhookEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 40 })
  provider: string;

  @Column({ name: "event_id", type: "varchar", length: 160 })
  eventId: string;

  @Column({ name: "event_type", type: "varchar", length: 80 })
  eventType: string;

  @CreateDateColumn({ name: "received_at", type: "timestamptz", default: () => "NOW()" })
  receivedAt: Date;
}
