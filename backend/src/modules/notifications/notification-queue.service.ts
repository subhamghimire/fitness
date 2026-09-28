import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, QueueOptions } from "bullmq";
import Redis from "ioredis";
import { RedisConnectionFactory } from "src/shared/redis";
import { NOTIFICATION_DELIVERY_MAX_ATTEMPTS } from "./entities";

/** Stage 3+4: one job per provider-backed channel. */
export const NOTIFICATION_DELIVERIES_QUEUE = "notifications.deliveries";
/** Stage 2: one job per outbox row, fanning out to the in-app channel. */
export const NOTIFICATION_EVENTS_QUEUE = "notifications.events";

/**
 * BullMQ job ids may not contain `:` — BullMQ uses it as its own key separator,
 * so a colon in a custom id silently produces a job that can never be found
 * again. The `jobIdFor` helpers below are the only sanctioned way to build one.
 */
const jobIdFor = (scope: string, key: string): string => `${scope}-${key}`;

/**
 * NOTIFICATION QUEUE SERVICE
 * ---------------------------------------------------------------------------
 * Owns the BullMQ producers for the pipeline. This is the "Background Job"
 * hop: nothing above it talks to Redis.
 *
 * Two queues, matching the two stages that need durable, retryable execution:
 *
 *   notifications.events      — the outbox relay hands off domain events here.
 *                                Retry policy is deliberately loose: the handler
 *                                is idempotent, so retrying is always safe and a
 *                                transient DB blip must not drop an event.
 *   notifications.deliveries  — one job per (notification, push|email).
 *                                `attempts` + exponential backoff IS the retry
 *                                behaviour; the delivery ledger records each
 *                                attempt so the retry is observable.
 *
 * `jobId` is derived from a stable natural key on both queues. BullMQ ignores an
 * `add()` whose id is still in the queue, so a relay that enqueues the same
 * outbox row twice (or two relay instances racing) produces one job. This is the
 * first line of defence against duplicate events; the database unique indexes
 * are the authoritative one, because BullMQ forgets job ids once a job is
 * completed and removed.
 */
@Injectable()
export class NotificationQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationQueueService.name);
  private connection: Redis | undefined;
  private eventsQueue: Queue | undefined;
  private deliveriesQueue: Queue | undefined;

  constructor(
    private readonly redisFactory: RedisConnectionFactory,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    this.connection = this.redisFactory.createClient();

    const eventsJobOptions: QueueOptions = {
      connection: this.connection,
      defaultJobOptions: {
        attempts: this.configService.get<number>("NOTIFICATION_EVENT_JOB_ATTEMPTS", 5),
        backoff: { type: "exponential", delay: 1000 },
        // Keep a bounded history: enough to debug, not enough to grow forever.
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 5000 }
      }
    };

    this.eventsQueue = new Queue(NOTIFICATION_EVENTS_QUEUE, eventsJobOptions);
    this.deliveriesQueue = new Queue(NOTIFICATION_DELIVERIES_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 86400, count: 5000 }
      }
    });
  }

  /** Enqueues the stage-2 handler job for an outbox row. */
  async enqueueEvent(outboxId: string): Promise<void> {
    if (!this.eventsQueue) throw new Error("Notification queue is not initialised");
    await this.eventsQueue.add("materialise", { outboxId }, { jobId: jobIdFor("event", outboxId) });
  }

  /** Enqueues the stage-3 delivery job for one notification channel. */
  async enqueueDelivery(job: { deliveryId: string; notificationId: string; channel: string }): Promise<void> {
    if (!this.deliveriesQueue) throw new Error("Notification queue is not initialised");
    await this.deliveriesQueue.add("deliver", job, { jobId: jobIdFor(job.channel, job.notificationId) });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.eventsQueue?.close(), this.deliveriesQueue?.close()].filter(Boolean) as Promise<void>[]);
    this.eventsQueue = undefined;
    this.deliveriesQueue = undefined;
  }
}
