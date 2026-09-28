import { Injectable, Logger } from "@nestjs/common";
import { EmailNotificationProvider, EmailMessage, ProviderSendResult, PushMessage, PushNotificationProvider } from "./notification-provider";

/**
 * Default provider implementations.
 *
 * They are *not* stubs that pretend to succeed silently: they log the payload at
 * debug level and return without a provider id, which keeps the full pipeline
 * (outbox → handler → delivery job → provider) executable and testable on a
 * machine with no FCM/SES credentials, while making it obvious in the logs that
 * a real provider is not wired up.
 *
 * Swapping in a real provider is a single provider override in
 * `NotificationsModule` — no change to the handler, the worker or any producer.
 */
@Injectable()
export class LoggingPushNotificationProvider extends PushNotificationProvider {
  private readonly logger = new Logger(LoggingPushNotificationProvider.name);

  send(message: PushMessage): Promise<ProviderSendResult> {
    this.logger.debug(`[push:noop] token=${message.token.slice(0, 8)}… "${message.title}" — ${message.body}`);
    return Promise.resolve({ providerMessageId: null });
  }
}

@Injectable()
export class LoggingEmailNotificationProvider extends EmailNotificationProvider {
  private readonly logger = new Logger(LoggingEmailNotificationProvider.name);

  send(message: EmailMessage): Promise<ProviderSendResult> {
    this.logger.debug(`[email:noop] to=${message.to} subject="${message.subject}"`);
    return Promise.resolve({ providerMessageId: null });
  }
}
