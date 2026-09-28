import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Shape of the object attached to `request.useragent` by the
 * `express-useragent` middleware that this decorator consumes.
 */
export interface UserAgentInfo {
  browser: string;
  version: string;
  os: string;
  platform: string;
  source: string;
  isBot: boolean;
  isMobile: boolean;
  isTablet: boolean;
}

type UserAgentRequest = Request & { useragent?: UserAgentInfo };

/**
 * Decorator to extract parsed user agent info from request
 * Returns a formatted string like "Chrome 120 on Windows 10" or the raw Details object
 */
export const UserAgent = createParamDecorator((data: "raw" | "formatted" | undefined, ctx: ExecutionContext): string | UserAgentInfo => {
  const request = ctx.switchToHttp().getRequest<UserAgentRequest>();
  const ua = request.useragent;

  if (!ua) {
    return "Unknown";
  }

  if (data === "raw") {
    return ua;
  }

  // Return formatted string by default
  const parts: string[] = [];

  if (ua.browser && ua.browser !== "unknown") {
    parts.push(`${ua.browser}${ua.version ? " " + ua.version : ""}`);
  }

  if (ua.os && ua.os !== "unknown") {
    parts.push(`on ${ua.os}`);
  }

  if (ua.platform && ua.platform !== "unknown" && ua.platform !== ua.os) {
    parts.push(`(${ua.platform})`);
  }

  // Handle special cases
  if (ua.isBot) parts.unshift("[Bot]");
  if (ua.isMobile) parts.push("- Mobile");
  if (ua.isTablet) parts.push("- Tablet");

  return parts.length > 0 ? parts.join(" ") : ua.source || "Unknown";
});
