import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MarketplaceAuditLog } from "./marketplace-audit-log.entity";

export interface AuditRecordInput {
  actorId?: string | null;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit writer. `record` catches everything: if the audit table
 * is unavailable the business operation that called it must still succeed —
 * a missing log line is recoverable, a failed payment is not.
 */
@Injectable()
export class MarketplaceAuditService {
  private readonly logger = new Logger(MarketplaceAuditService.name);

  constructor(@InjectRepository(MarketplaceAuditLog) private readonly logs: Repository<MarketplaceAuditLog>) {}

  async record(action: string, input: AuditRecordInput = {}): Promise<void> {
    try {
      const row = this.logs.create({
        actorId: input.actorId ?? null,
        action,
        entityType: input.entityType ?? "unknown",
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {}
      });
      await this.logs.save(row);
    } catch (err) {
      this.logger.warn(`Audit write failed for action=${action}: ${(err as Error).message}`);
    }
  }

  async list(query: { action?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }): Promise<{ items: MarketplaceAuditLog[]; total: number }> {
    // Query params arrive as strings and may be garbage ("abc", NaN): coerce
    // defensively so a bad ?limit= can never reach take() as NaN.
    const limit = Number.isFinite(query.limit) ? Math.min(query.limit as number, 200) : 50;
    const offset = Number.isFinite(query.offset) && (query.offset as number) >= 0 ? (query.offset as number) : 0;
    const qb = this.logs.createQueryBuilder("l").orderBy("l.createdAt", "DESC");
    if (query.action) qb.andWhere("l.action = :action", { action: query.action });
    if (query.entityType) qb.andWhere("l.entityType = :entityType", { entityType: query.entityType });
    if (query.entityId) qb.andWhere("l.entityId = :entityId", { entityId: query.entityId });
    qb.skip(offset).take(limit);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
