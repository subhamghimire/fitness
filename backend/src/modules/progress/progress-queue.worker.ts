import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProgressProjectionService } from "./progress-projection.service";

/**
 * Background queue consumer.
 *
 * Polls the durable `progress_workout_queue` (FOR UPDATE SKIP LOCKED) on a
 * timer and drains it through `ProgressProjectionService`. Projection work is
 * therefore async and decoupled from the request/sync path — dashboard reads
 * never wait for a recalculation to finish.
 *
 * The poller is disabled under `NODE_ENV=test` so test suites never spawn
 * background timers against mocked stores.
 */
@Injectable()
export class ProgressQueueWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProgressQueueWorker.name);
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly projectionService: ProgressProjectionService,
    private readonly configService: ConfigService
  ) {
    this.batchSize = this.configService.get<number>("PROGRESS_QUEUE_BATCH_SIZE", 25);
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;
    const intervalMs = this.configService.get<number>("PROGRESS_QUEUE_POLL_MS", 5000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  async tick(): Promise<void> {
    try {
      const result = await this.projectionService.processQueue(this.batchSize);
      if (result.claimed > 0) {
        this.logger.debug(`Progress projection: ${result.processed} processed, ${result.failed} failed (of ${result.claimed} claimed)`);
      }
    } catch (e) {
      this.logger.error("Progress queue poll failed", e instanceof Error ? e.stack : String(e));
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
