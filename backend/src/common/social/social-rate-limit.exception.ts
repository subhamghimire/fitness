import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * The 429 every social write path raises when a user exhausts a quota.
 *
 * ─── Why this is a class and not a bare `HttpException` ─────────────────────
 * A service has no access to the Express response, and Nest 11's `HttpException`
 * cannot carry headers, so the retry delay has nowhere to go in a header. This
 * exception keeps `retryAfterSeconds` as a *typed* field anyway, for two reasons:
 *
 *   - the global `AppExceptionFilter` renders `{ success, status, message }` and
 *     nothing else, so a client that parses the body cannot see the delay as a
 *     number. It is stated in the message instead, which is what a human reads.
 *   - a future `RateLimitGuard` over the throttler's storage adapter (the upgrade
 *     path named in `SocialRateLimiter`) *can* read the field and emit a real
 *     `Retry-After` header, because a guard does hold the response.
 *
 * So the value is captured now, at the only place that knows it, and rendering
 * it is a transport concern that can change without touching any social service.
 */
export class SocialRateLimitException extends HttpException {
  constructor(
    readonly action: string,
    readonly retryAfterSeconds: number,
    readonly limit: number
  ) {
    super(`Too many ${action} requests (limit ${limit}). Try again in ${retryAfterSeconds}s.`, HttpStatus.TOO_MANY_REQUESTS);
  }
}
