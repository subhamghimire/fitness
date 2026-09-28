import { INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { ServerOptions } from "socket.io";
import { RedisConnectionFactory } from "src/shared/redis";

/**
 * SOCKET.IO REDIS ADAPTER
 * ---------------------------------------------------------------------------
 * Installs cross-instance fan-out for WebSockets. Socket.IO's default adapter
 * broadcasts only to sockets held by *this* process, which is invisible in
 * development (one instance) and silently broken the moment a second instance
 * is deployed: a message would reach the sender's own sockets and none of the
 * recipient's. The redis-adapter fixes that by publishing every room emit to
 * Redis, so all instances see it.
 *
 * Redis is not new infrastructure for this codebase — the notification pipeline's
 * BullMQ queues already require it — so this reuses the same
 * `RedisConnectionFactory` and the same `REDIS_URL` rather than introducing a
 * second configuration surface.
 *
 * Two design choices worth stating:
 *
 *   - **Fail open, loudly.** If the adapter cannot be created, this logs an error
 *     and keeps the default in-memory adapter, so a Redis outage degrades
 *     fan-out (delivery resumes once Redis returns) instead of refusing to boot.
 *     Crashing the whole API over the messaging transport would be a far worse
 *     trade: HTTP would go down with it.
 *   - **Dedicated clients.** The adapter needs a publisher and a subscriber. They
 *     come from the factory, which registers both for shutdown, so `app.close()`
 *     never leaves a live socket holding the process open.
 */
export class MessagingIoAdapter extends IoAdapter {
  private readonly logger = new Logger(MessagingIoAdapter.name);
  private readonly app: INestApplicationContext;

  constructor(app: INestApplicationContext) {
    super(app);
    // `IoAdapter` keeps its context private, so hold a reference for
    // `createIOServer` (which has no app argument of its own).
    this.app = app;
  }

  /**
   * Called once by Nest for every gateway server. Attaching the adapter is
   * idempotent, and a gateway mounted on a path rather than a namespace still
   * gets a working server, so the return value is passed through unchanged.
   */
  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as import("socket.io").Server;

    try {
      const factory = this.app.get(RedisConnectionFactory);
      const { publisher, subscriber } = factory.createPubSubClients();
      server.adapter(createAdapter(publisher, subscriber));
      this.logger.log("Socket.IO redis-adapter attached — cross-instance messaging fan-out enabled");
    } catch (error) {
      this.logger.error(`Failed to attach the Socket.IO redis-adapter; messaging fan-out is limited to this instance (${error instanceof Error ? error.message : String(error)})`);
    }

    return server;
  }
}
