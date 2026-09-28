import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Repository, IsNull } from "typeorm";
import { JwtPayload } from "src/modules/auth/strategies/jwt.strategy";
import { User } from "src/modules/users/entities/user.entity";

/** Room name for a conversation's live frames. */
export const conversationRoom = (conversationId: string): string => `conversation:${conversationId}`;

/**
 * The identity a socket is allowed to act as, established once at connect time.
 *
 * Stored on the socket rather than re-derived per frame: an attacker cannot
 * influence it after the handshake, and every frame handler is forced to work
 * from a value that was validated exactly once, in one place.
 */
export interface SocketIdentity {
  userId: string;
  name: string | null;
}

/**
 * SOCKET AUTHENTICATOR
 * ---------------------------------------------------------------------------
 * One-time authentication for a WebSocket connection, deliberately factored out
 * of the gateway so the rule "a frame is only ever handled on behalf of a
 * verified identity" has a single implementation and a single set of tests.
 *
 * Why the token is verified *here* rather than by the usual `JwtAuthGuard`:
 * guards run on the HTTP request pipeline, and a WebSocket connection is a
 * single long-lived upgrade followed by frames on a channel the guard pipeline
 * never sees. The same `JWT_SECRET` is used, so there is one authority on
 * validity — only the extraction point differs.
 *
 * The token is accepted from `handshake.auth.token` (the socket.io client
 * convention, and the only option for most mobile clients, which cannot set
 * headers on a WebSocket handshake), from a `token` query parameter, or from an
 * `Authorization: Bearer` header. All three are tried because every real client
 * SDK picks a different one.
 *
 * The user row is re-read on connect. A JWT is stateless and stays valid until
 * it expires, so without this a deleted or disabled account could keep an open
 * socket until the token timed out. One indexed lookup per *connection* — not
 * per frame — is a cheap price for immediate revocation.
 */
export class SocketAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersRepo: Repository<User>
  ) {}

  /** Verifies the handshake and resolves the identity, or throws 401. */
  async authenticate(handshake: { auth?: Record<string, unknown>; query?: Record<string, unknown>; headers?: Record<string, unknown> }): Promise<SocketIdentity> {
    const token = this.extractToken(handshake);
    if (!token) throw new UnauthorizedException("Missing access token");

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      // Never surface *why* the token failed (expired vs bad signature vs
      // malformed): that is a free oracle for an attacker probing tokens.
      throw new UnauthorizedException("Invalid or expired access token");
    }

    if (!payload?.sub) throw new UnauthorizedException("Invalid access token");

    const user = await this.usersRepo.findOne({ where: { id: payload.sub, isDeleted: false, deletedAt: IsNull() }, select: { id: true, name: true } });
    if (!user) throw new UnauthorizedException("Account no longer active");

    return { userId: user.id, name: user.name ?? null };
  }

  private extractToken(handshake: { auth?: Record<string, unknown>; query?: Record<string, unknown>; headers?: Record<string, unknown> }): string | null {
    const candidates: unknown[] = [handshake.auth?.token, handshake.query?.token, headerValue(handshake.headers, "authorization")];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const trimmed = candidate.trim();
      if (trimmed.length === 0) continue;
      return trimmed.replace(/^Bearer\s+/i, "");
    }
    return null;
  }
}

/** Header names arrive lower-cased on the raw handshake object. */
function headerValue(headers: Record<string, unknown> | undefined, name: string): unknown {
  if (!headers) return undefined;
  return headers[name] ?? headers[name.toLowerCase()];
}
