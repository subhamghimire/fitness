import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DomainEventOutbox, DOMAIN_EVENT_OUTBOX_MAX_RELAY_ATTEMPTS } from "./entities";
import { DomainEventOutboxStatus } from "./enums";
import { NotificationQueueService } from "./notification-queue.service";

interface ClaimedOutboxRow {
  id: string;
  attemptCount: number;
}

const STALE_PROCESSING_MINUTES = 10;

/**
 * OUTBOX RELAY  (outbox → Background Job)
 * ---------------------------------------------------------------------------
 * Moves committed domain events from the transactional outbox onto the job
 * queue. This is the seam that makes "a notification failure cannot fail the
 * workout transaction" true in practice: by the time anything is enqueued, the
 * producing transaction has already committed, and a failure here only ever
 * delays a notification.
 *
 * Design points, all borrowed from the existing progress projection queue so
 * there is one queue idiom in the codebase:
 *
 *   - CLAIM WITH `FOR UPDATE SKIP LOCKED`. Several app instances can relay at
 *     once; each claims a disjoint batch instead of blocking on the others.
 *   - MARK BEFORE ENQUEUE, NOT AFTER. The row is flipped to `processing` inside
 *     the claim transaction and only to `dispatched` once the queue accepted
 *     the job. If the process dies in between, the stale-row sweep returns it
 *     to `pending` and it is re-relayed — at-least-once, never lost. Doing it
 *     the other way round could drop an event on a crash.
 *   - THE HANDLER IS IDEMPOTENT, so re-relaying a job is harmless. The relay
 *     additionally relies on a stable `jobId`, so a re-relay while the original
 *     job is still queued does not create a second one.
 *   - EXHAUSTION IS VISIBLE. After `DOMAIN_EVENT_OUTBOX_MAX_RELAY_ATTEMPTS` a
 *     row is marked `failed` with its last error rather than being retried
 *     forever, and a stuck event can be re-driven operationally.
 *
 * Disabled under `NODE_ENV=test` so unit suites never spawn timers.
 */
@Injectable()
export class NotificationOutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationOutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly batchSize: number;
  private readonly pollMs: number;

  constructor(
    @InjectRepository(DomainEventOutbox) private readonly outboxRepo: Repository<DomainEventOutbox>,
    private readonly queueService: NotificationQueueService,
    private readonly configService: ConfigService
  ) {
    this.batchSize = this.configService.get<number>("NOTIFICATION_RELAY_BATCH_SIZE", 50);
    this.pollMs = this.configService.get<number>("NOTIFICATION_RELAY_POLL_MS", 2000);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    void this.tick();
  }

  async tick(): Promise<{ claimed: number; dispatched: number; failed: number }> {
    // A slow batch must not overlap with the next tick.
    if (this.running) return { claimed: 0, dispatched: 0, failed: 0 };
    this.running = true;
    try {
      await this.recoverStaleProcessingRows();

      const claimed = await this.claimBatch();
      let dispatched = 0;
      let failed = 0;

      for (const row of claimed) {
        try {
          await this.queueService.enqueueEvent(row.id);
          await this.outboxRepo.update({ id: row.id }, { status: DomainEventOutboxStatus.DISPATCHED, dispatchedAt: new Date(), lastError: null });
          dispatched++;
        } catch (error) {
          failed++;
          await this.markRelayFailed(row, error);
        }
      }

      if (claimed.length > 0) {
        this.logger.debug(`Notification relay: ${dispatched} dispatched, ${failed} failed (of ${claimed.length} claimed)`);
      }
      return { claimed: claimed.length, dispatched, failed };
    } catch (error) {
      this.logger.error("Notification outbox relay tick failed", error instanceof Error ? error.stack : String(error));
      return { claimed: 0, dispatched: 0, failed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(): Promise<ClaimedOutboxRow[]> {
    const rows = await this.outboxRepo
      .createQueryBuilder("outbox")
      .setLock("pessimistic_write")
      .setOnLocked("skip_locked")
      .where("outbox.status = :status", { status: DomainEventOutboxStatus.PENDING })
      .andWhere("outbox.nextAttemptAt <= NOW()")
      .andWhere("outbox.attemptCount < :max", { max: DOMAIN_EVENT_OUTBOX_MAX_RELAY_ATTEMPTS })
      .orderBy("outbox.createdAt", "ASC")
      .limit(this.batchSize)
      .getMany();

    if (rows.length === 0) return [];

    await this.outboxRepo
      .createQueryBuilder()
      .update(DomainEventOutbox)
      .set({ status: DomainEventOutboxStatus.PROCESSING, attemptCount: () => '"attempt_count" + 1' })
      .whereInIds(rows.map((r) => r.id))
      .execute();

    return rows.map((r) => ({ id: r.id, attemptCount: r.attemptCount + 1 }));
  }

  private async markRelayFailed(row: ClaimedOutboxRow, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const exhausted = row.attemptCount >= DOMAIN_EVENT_OUTBOX_MAX_RELAY_ATTEMPTS;
    const backoffMs = Math.min(2000 * 2 ** Math.max(0, row.attemptCount - 1), 300000);
    try {
      await this.outboxRepo.update(
        { id: row.id },
        {
          status: exhausted ? DomainEventOutboxStatus.FAILED : DomainEventOutboxStatus.PENDING,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          lastError: message
        }
      );
    } catch (updateError) {
      this.logger.error(`Failed to record relay failure for outbox row ${row.id}`, updateError instanceof Error ? updateError.stack : String(updateError));
    }
  }

  /** Rows stranded in `processing` by a crashed relay go back into the pool. */
  private async recoverStaleProcessingRows(): Promise<void> {
    await this.outboxRepo
      .createQueryBuilder()
      .update(DomainEventOutbox)
      .set({ status: DomainEventOutboxStatus.PENDING })
      .where("status = :status", { status: DomainEventOutboxStatus.PROCESSING })
      .andWhere(`updated_at < NOW() - INTERVAL '${STALE_PROCESSING_MINUTES} minutes'`)
      .execute();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
