import { Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";
import { User } from "../../users/entities/user.entity";

export type SyncOperation = "create" | "update" | "delete";

/**
 * Append-only synchronization change log.
 *
 * `id` is a monotonic server-side sequence and the pull cursor for every device.
 * Each row records one accepted mutation of a syncable entity owned by a user.
 *
 * This table intentionally does NOT extend AbstractEntity: it is log metadata,
 * not a domain entity, so it has no isDeleted/deletedAt/deletedBy columns.
 */
@Entity("sync_changes")
export class SyncChange {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "entity_type", type: "varchar", length: 50 })
  entityType: string;

  @Column({ name: "entity_id", type: "uuid" })
  entityId: string;

  @Column({ type: "varchar", length: 10 })
  operation: SyncOperation;

  @Column({ type: "int" })
  revision: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;
}
