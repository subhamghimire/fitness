import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "../../users/entities/user.entity";

@Entity("user_sync_state")
export class UserSyncState extends AbstractEntity {
  @Index({ unique: true })
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "sync_token", type: "varchar", length: 100, nullable: true })
  syncToken: string | null;

  @Column({ name: "client_id", type: "varchar", length: 100, nullable: true })
  clientId: string | null;

  /** Monotonic sync cursor: the last sync_changes.id seen by this device. */
  @Column({ name: "sync_revision", type: "int", default: 0 })
  syncRevision: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;
}
