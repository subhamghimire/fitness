/**
 * NOTIFICATION PROVIDER ABSTRACTIONS
 * ---------------------------------------------------------------------------
 * The final stage of the pipeline. Nothing above this file knows whether push
 * goes out over FCM, APNs or a console log, and nothing above this file knows
 * whether email goes out over SES, Postmark or a no-op.
 *
 * The contract the pipeline relies on:
 *
 *   - `send()` is idempotent from the *caller's* perspective: the delivery
 *     ledger guarantees at most one success per (notification, channel), so a
 *     provider never needs to de-duplicate on its own.
 *   - a rejected promise is a **retryable** failure. It must not throw for
 *     "the user disabled this", which is a `SKIPPED` outcome, not an error.
 *   - implementations must be safe to call concurrently for different
 *     notifications and must not block the worker's event loop on I/O they do
 *     not need (fire-and-forget analytics, token refresh prefetch, …).
 */

export interface PushMessage {
  /** Provider device token. */
  token: string;
  title: string;
  body: string;
  /** Deep-link / custom payload for the mobile client. */
  data?: Record<string, unknown>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  data?: Record<string, unknown>;
}

export interface ProviderSendResult {
  /** Provider-side id, persisted on the delivery row for support/debugging. */
  providerMessageId?: string | null;
  /** Set when the provider had nothing to do (e.g. all tokens stale). */
  skipped?: boolean;
}

export abstract class PushNotificationProvider {
  abstract send(message: PushMessage): Promise<ProviderSendResult>;
}

export abstract class EmailNotificationProvider {
  abstract send(message: EmailMessage): Promise<ProviderSendResult>;
}
