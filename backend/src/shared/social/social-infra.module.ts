import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RedisModule } from "../redis";
import { SocialCacheService } from "./social-cache.service";
import { SocialRateLimiter } from "./social-rate-limiter.service";
import { SocialUserLoader } from "./social-user-loader.service";
import { SocialUserPresenter } from "./social-user-presenter.service";

/**
 * SOCIAL INFRASTRUCTURE
 * ---------------------------------------------------------------------------
 * The cross-module services every social module depends on: the Redis graph
 * cache, the Redis write rate limiter, the batch user hydrator, and the single
 * user mapper that keeps "what does a user look like in a social payload"
 * identical everywhere.
 *
 * `RedisModule` is already `@Global()`, so the only thing this module has to do
 * is publish these services globally — the same reasoning as `RedisModule`
 * itself: they own no domain state, and making each of the six social modules
 * import them (and each own a duplicate instance) would add wiring for no
 * benefit. Note the graph *rules* (what a block means, which direction it
 * applies) deliberately do **not** live here — those belong to FollowsModule,
 * which owns the graph rows; this module only owns transport-level concerns.
 *
 * Because they are provided as classes (not tokens bound to an interface), a
 * testing module can replace any of them with `useValue` and get a fake — which
 * is exactly how the social integration tests run without a Redis server.
 */
@Global()
@Module({
  imports: [RedisModule, ConfigModule],
  providers: [SocialCacheService, SocialRateLimiter, SocialUserLoader, SocialUserPresenter],
  exports: [SocialCacheService, SocialRateLimiter, SocialUserLoader, SocialUserPresenter]
})
export class SocialInfraModule {}
