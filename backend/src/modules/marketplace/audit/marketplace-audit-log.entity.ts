import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * MARKETPLACE AUDIT LOG — append-only.
 *
 * Every state-changing marketplace operation writes one row: who did it (null
 * for provider webhooks), what happened, which entity it touched, and a JSON
 * snapshot of the decision inputs. There is deliberately no update path, no
 * soft delete, and no `AbstractEntity` inheritance: an audit row is immutable
 * infrastructure metadata, like the notification outbox.
 *
 * The writer (`MarketplaceAuditService.record`) never throws — a logging
 * outage must not fail the business transaction it describes.
 */
@Entity({ name: "marketplace_audit_logs" })
@Index("idx_marketplace_audit_entity", ["entityType", "entityId"])
@Index("idx_marketplace_audit_action", ["action"])
@Index("idx_marketplace_audit_actor", ["actorId"])
export class MarketplaceAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @Column({ type: "varchar", length: 60 })
  action: string;

  @Column({ name: "entity_type", type: "varchar", length: 40 })
  entityType: string;

  @Column({ name: "entity_id", type: "varchar", length: 80, nullable: true })
  entityId: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;
}
