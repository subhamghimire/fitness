import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis, { RedisOptions } from "ioredis";

/**
 * REDIS CONNECTION FACTORY
 * ---------------------------------------------------------------------------
 * Single owner of every Redis client in the process. Two consumers need it:
 *
 *   - the notification pipeline (BullMQ producers and workers);
 *   - the messaging gateway's Socket.IO Redis adapter, which is what makes
 *     fan-out correct when more than one app instance is running.
 *
 * Both are configured from a single `REDIS_URL`, and both are created here so
 * the two very different client requirements cannot drift apart:
 *
 *   - BullMQ **workers** must have `maxRetriesPerRequest: null`. A worker that
 *     lets a command time out and retry silently will drop a lock and can
 *     process the same job twice. The failure has to surface as an error and be
 *     handed back to the job's retry policy instead.
 *   - Socket.IO's pub/sub clients must not be in subscriber mode for commands,
 *     and they must tolerate long-lived idle connections, so they get their own
 *     defaults.
 *
 * Every client is registered for shutdown so `app.close()` never leaves the
 * process holding an open socket (which would keep Node alive and, on a
 * container platform, delay termination).
 */
@Injectable()
export class RedisConnectionFactory implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnectionFactory.name);
  private readonly url: string;
  private readonly clients: Redis[] = [];

  constructor(configService: ConfigService) {
    this.url = configService.getOrThrow<string>("REDIS_URL");
  }

  get redisUrl(): string {
    return this.url;
  }

  /** Options for a client that must be a reliable command channel. */
  workerOptions(overrides: RedisOptions = {}): RedisOptions {
    return { maxRetriesPerRequest: null, enableReadyCheck: true, ...overrides };
  }

  createClient(overrides: RedisOptions = {}): Redis {
    const client = new Redis(this.url, { ...overrides, lazyConnect: false });
    this.track(client);
    return client;
  }

  /** Publisher/subscriber pair for Socket.IO's `createAdapter`. */
  createPubSubClients(): { publisher: Redis; subscriber: Redis } {
    return {
      publisher: this.createClient(),
      subscriber: this.createClient()
    };
  }

  private track(client: Redis): void {
    this.clients.push(client);
    // A Redis blip must never take the HTTP API down with an unhandled
    // 'error' event; BullMQ and the socket adapter both surface their own
    // retry/buffering behaviour on top of this.
    client.on("error", (err: Error) => this.logger.warn(`Redis client error: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.clients.map(async (client) => {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      })
    );
    this.clients.length = 0;
  }
}
