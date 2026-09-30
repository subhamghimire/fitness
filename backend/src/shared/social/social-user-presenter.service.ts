import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { User } from "src/modules/users/entities/user.entity";

/**
 * The only user shape any social response is allowed to contain.
 *
 * Deliberately minimal: `id`, `name` and a picture. **No email** — a follower
 * list or a comment thread must never become an address book, and having one
 * DTO for every social surface is what makes that structural rather than a
 * review-time decision repeated in five mappers.
 */
export class SocialUserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, description: "Absolute URL of the profile picture, when there is one" })
  avatarUrl: string | null;
}

/**
 * SOCIAL USER PRESENTER
 * ---------------------------------------------------------------------------
 * One mapper from `User` to `SocialUserSummaryDto`, shared by every social
 * module. It owns two decisions that are easy to get subtly wrong per-module:
 *
 *   - the avatar precedence (`googlePhotoUrl` wins over the uploaded file, which
 *     matches the auth and user modules), and
 *   - the URL shape (`APP_URL` + the stored relative path), so a client never
 *     has to guess whether a path is absolute.
 *
 * Lives with the other cross-module social services so the five social modules
 * cannot drift apart on what a "user" looks like in a payload.
 */
@Injectable()
export class SocialUserPresenter {
  constructor(private readonly configService: ConfigService) {}

  toSummary(user: Pick<User, "id" | "name" | "avatar" | "googlePhotoUrl">): SocialUserSummaryDto {
    return { id: user.id, name: user.name, avatarUrl: this.avatarUrl(user) };
  }

  toSummaries(users: (Pick<User, "id" | "name" | "avatar" | "googlePhotoUrl"> | undefined)[]): SocialUserSummaryDto[] {
    return users.filter((user): user is Pick<User, "id" | "name" | "avatar" | "googlePhotoUrl"> => Boolean(user)).map((user) => this.toSummary(user));
  }

  private avatarUrl(user: Pick<User, "avatar" | "googlePhotoUrl">): string | null {
    if (user.googlePhotoUrl) return user.googlePhotoUrl;
    const path = user.avatar?.path;
    if (!path) return null;
    const appUrl = this.configService.get<string>("APP_URL") ?? "";
    return `${appUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }
}
