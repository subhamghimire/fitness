import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker, WorkerOptions } from "bullmq";
import { RedisConnectionFactory } from "src/shared/redis";
import { NOTIFICATION_EVENTS_QUEUE } from "./notification-queue.service";
import { NotificationEventHandler } from "./notification-event.handler";

/**
 * EVENT WORKER  (Background Job consumer for stage 2)
 * ---------------------------------------------------------------------------
 * A deliberately thin adapter: pull an outbox id off the job, hand it to
 * `NotificationEventHandler`, and translate the result into BullMQ's vocabulary.
 *
 * It exists to keep the queue library out of the handler. Everything that
 * matters — audience resolution, preference filtering, deduplication — is
 * testable with no Redis, and this file is the only place that knows BullMQ
 * exists.
 *
 * Failure policy: the handler throws → the job is retried with exponential
 * backoff up to `attempts`, then parked in the failed set. Retrying is always
 * safe because the handler is idempotent, so an exhausted-but-eventually-fixed
 * dependency costs nothing but a repeated no-op.
 *
 * Disabled under `NODE_ENV=test`.
 */
@Injectable()
export class NotificationEventWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationEventWorker.name);
  private worker: Worker | undefined;

  constructor(
    private readonly handler: NotificationEventHandler,
    private readonly redisFactory: RedisConnectionFactory,
    private readonly configService: ConfigService
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;

    const options: WorkerOptions = {
      connection: this.redisFactory.createClient(this.redisFactory.workerOptions()),
      concurrency: this.configService.get<number>("NOTIFICATION_EVENT_WORKER_CONCURRENCY", 10)
    };

    this.worker = new Worker(NOTIFICATION_EVENTS_QUEUE, (job: Job<{ outboxId: string }>) => this.process(job), options);

    this.worker.on("failed", (job, error) => {
      this.logger.error(`Notification event job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`);
    });
    this.worker.on("error", (error) => this.logger.error(`Notification event worker error: ${error.message}`));
  }

  private async process(job: Job<{ outboxId: string }>): Promise<{ outcome: string; notificationsCreated: number }> {
    const result = await this.handler.handle(job.data.outboxId);
    if (result.status === "duplicate") {
      this.logger.debug(`Outbox ${job.data.outboxId} replayed: ${result.duplicatesSkipped} existing notification(s) left untouched`);
    }
    return { outcome: result.status, notificationsCreated: result.notificationsCreated };
  }

  async onApplicationShutdown(): Promise<void> {
    // `close()` waits for in-flight jobs so a deploy does not abandon a
    // half-delivered notification; BullMQ re-queues anything still active.
    await this.worker?.close();
    this.worker = undefined;
  }
}
