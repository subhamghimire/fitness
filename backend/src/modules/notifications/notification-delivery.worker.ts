import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker, WorkerOptions } from "bullmq";
import { RedisConnectionFactory } from "src/shared/redis";
import { NOTIFICATION_DELIVERIES_QUEUE } from "./notification-queue.service";
import { NotificationDeliveryProcessor } from "./notification-delivery.processor";

/**
 * DELIVERY WORKER  (Background Job consumer for stages 3 + 4)
 * ---------------------------------------------------------------------------
 * Another deliberately thin adapter over `NotificationDeliveryProcessor`.
 *
 * THE RETRY MECHANISM LIVES HERE, and only here: a `retryable_failure` is
 * rethrown, which is how BullMQ knows to reschedule the job under its
 * exponential backoff until `attempts` is exhausted. The processor has already
 * recorded the attempt, the error and the next-eligible time in the delivery
 * ledger before this point, so a retry storm is observable rather than opaque.
 *
 * Outcomes that are NOT rethrown, because retrying them cannot help:
 *   `already_sent`  — a redelivered job must not re-send;
 *   `skipped`       — the user opted out, or has no device;
 *   `missing`       — the notification or delivery row is gone;
 *   `exhausted`     — the processor already marked it FAILED; the error is
 *                     surfaced once for the failed-job set and then dropped.
 *
 * Disabled under `NODE_ENV=test`.
 */
@Injectable()
export class NotificationDeliveryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private worker: Worker | undefined;

  constructor(
    private readonly processor: NotificationDeliveryProcessor,
    private readonly redisFactory: RedisConnectionFactory,
    private readonly configService: ConfigService
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;

    const options: WorkerOptions = {
      connection: this.redisFactory.createClient(this.redisFactory.workerOptions()),
      concurrency: this.configService.get<number>("NOTIFICATION_DELIVERY_WORKER_CONCURRENCY", 20)
    };

    this.worker = new Worker(NOTIFICATION_DELIVERIES_QUEUE, (job: Job<{ deliveryId: string; notificationId: string; channel: string }>) => this.process(job), options);

    this.worker.on("failed", (job, error) => {
      this.logger.error(`Notification delivery job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`);
    });
    this.worker.on("error", (error) => this.logger.error(`Notification delivery worker error: ${error.message}`));
  }

  private async process(job: Job<{ deliveryId: string; notificationId: string; channel: string }>): Promise<{ outcome: string }> {
    // The delivery row is the unit of work: it already carries the attempt
    // count, max attempts and terminal state the retry policy needs.
    const { outcome, error } = await this.processor.attempt(job.data.deliveryId);

    if (outcome === "retryable_failure") throw new Error(error ?? "Notification delivery failed");
    if (outcome === "exhausted") throw new Error(error ?? "Notification delivery exhausted its retries");

    return { outcome };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
