import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { NotificationAudience } from "src/common/events";
import { CoachClientRelationship } from "src/modules/coach-client/entities/coach-client-relationship.entity";
import { RelationshipStatus } from "src/modules/coach-client/enums";
import { ConversationParticipant } from "src/modules/messaging/entities/conversation-participant.entity";

/**
 * AUDIENCE RESOLVER
 * ---------------------------------------------------------------------------
 * Turns the declarative `NotificationAudience` carried by a domain event into a
 * concrete list of user ids, at handling time rather than at publish time.
 *
 * Resolving lazily is a deliberate design choice, not an optimisation:
 *
 *   - the producer stays cheap. A sync batch that completes a workout does not
 *     pay for a coach lookup inside the transaction it is trying to keep short.
 *   - the resolution is fresher. If a user starts coaching someone between the
 *     workout finishing and the job running, that coach is notified; had the
 *     recipient list been frozen at publish time they would not be.
 *   - producers do not need to know the notification domain's rules. Only this
 *     service knows that "an active coach" means `status = ACTIVE` and
 *     `endedAt IS NULL`.
 *
 * The result is always de-duplicated, and self-notification is filtered only
 * when the audience asks for it — a PR is notified *to* the athlete who set it,
 * whereas a comment is never notified back to its author.
 */
@Injectable()
export class NotificationAudienceResolver {
  constructor(
    @InjectRepository(CoachClientRelationship) private readonly relationshipRepo: Repository<CoachClientRelationship>,
    @InjectRepository(ConversationParticipant) private readonly participantRepo: Repository<ConversationParticipant>
  ) {}

  async resolve(audience: NotificationAudience, actorId: string | null): Promise<string[]> {
    const recipients = await this.resolveRaw(audience);
    const withoutSelf = audience.kind !== "conversation_participants" && audience.excludeActor && actorId ? recipients.filter((id) => id !== actorId) : recipients;
    return [...new Set(withoutSelf)];
  }

  private async resolveRaw(audience: NotificationAudience): Promise<string[]> {
    switch (audience.kind) {
      case "users":
        return audience.userIds.filter((id): id is string => Boolean(id));

      case "user_and_active_coach": {
        const relationships = await this.relationshipRepo.find({
          where: { clientId: audience.userId, status: RelationshipStatus.ACTIVE, isDeleted: false, endedAt: IsNull() },
          relations: { coach: true },
          select: { clientId: true, coach: { userId: true } }
        });
        const coachUserIds = relationships.map((r) => r.coach?.userId).filter((id): id is string => Boolean(id));
        return [audience.userId, ...coachUserIds];
      }

      case "conversation_participants": {
        // Bounded by CONVERSATION_MAX_PARTICIPANTS, so filtering in memory is
        // cheaper and clearer than a `NOT IN` predicate — and it avoids the
        // `NOT IN (NULL)` trap that would silently match nothing.
        const participants = await this.participantRepo.find({
          where: { conversationId: audience.conversationId, leftAt: IsNull() },
          select: { userId: true }
        });
        return participants.map((p) => p.userId).filter((id) => id !== audience.excludeUserId);
      }
    }
  }
}
