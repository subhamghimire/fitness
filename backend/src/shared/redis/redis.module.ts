import { Global, Module } from "@nestjs/common";
import { RedisConnectionFactory } from "./redis-connection.factory";

/**
 * Shared Redis infrastructure (BullMQ producers/workers, Socket.IO adapter).
 *
 * Global because it is pure infrastructure with no domain ownership: the
 * factory is a single connection pool owner that several unrelated modules need,
 * and duplicating the provider per module would give each one its own set of
 * clients and its own shutdown ordering.
 */
@Global()
@Module({
  providers: [RedisConnectionFactory],
  exports: [RedisConnectionFactory]
})
export class RedisModule {}
