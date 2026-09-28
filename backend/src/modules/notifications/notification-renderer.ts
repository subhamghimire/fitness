import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  CoachInvitationReceivedPayload,
  CommentAddedPayload,
  DomainEvent,
  DomainEventType,
  MessageReceivedPayload,
  NewFollowerPayload,
  PersonalRecordAchievedPayload,
  ProgramAssignedPayload,
  WorkoutCompletedPayload,
  excerpt
} from "src/common/events";
import { User } from "src/modules/users/entities/user.entity";
import { JsonObject } from "src/common/json";
import { EVENT_TYPE_TO_NOTIFICATION_TYPE, NotificationType } from "./enums";

export interface RenderedNotification {
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string | null;
  data: JsonObject;
}

/** Human labels for the derived PR types (`best_weight_kg` -> "Best weight"). */
const PR_LABELS: Readonly<Record<string, string>> = {
  best_weight_kg: "Heaviest lift",
  best_reps: "Most reps",
  best_volume_kg: "Biggest session volume",
  best_estimated_1rm_kg: "Estimated 1RM",
  best_distance_m: "Longest distance",
  best_time_seconds: "Best time"
};

const PR_UNITS: Readonly<Record<string, string>> = {
  best_weight_kg: "kg",
  best_volume_kg: "kg",
  best_estimated_1rm_kg: "kg",
  best_reps: "reps",
  best_distance_m: "m",
  best_time_seconds: "s"
};

const displayActor = (name: string | null | undefined, fallback = "Someone"): string => (name && name.trim() ? name.trim() : fallback);

/**
 * NOTIFICATION RENDERER
 * ---------------------------------------------------------------------------
 * The single place where an event becomes human-readable copy. Keeping it here
 * means the handler, the workers and the producers all agree on wording, and a
 * copy change never touches a business service.
 *
 * Actor names are resolved in **one batched lookup** per event rather than one
 * query per recipient: a workout completed for an athlete with three coaches
 * must not turn into four round-trips inside a background job.
 */
@Injectable()
export class NotificationRenderer {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  async render(event: DomainEvent): Promise<RenderedNotification> {
    const type = EVENT_TYPE_TO_NOTIFICATION_TYPE[event.type];
    const actorName = await this.resolveActorName(event.actorId);

    switch (event.type) {
      case DomainEventType.WORKOUT_COMPLETED:
        return this.renderWorkoutCompleted(event.payload, type, actorName);
      case DomainEventType.PERSONAL_RECORD_ACHIEVED:
        return this.renderPersonalRecord(event.payload, type);
      case DomainEventType.COACH_INVITATION_RECEIVED:
        return this.renderCoachInvitation(event.payload, type);
      case DomainEventType.PROGRAM_ASSIGNED:
        return this.renderProgramAssigned(event.payload, type, actorName);
      case DomainEventType.COMMENT_ADDED:
        return this.renderComment(event.payload, type, actorName);
      case DomainEventType.NEW_FOLLOWER:
        return this.renderFollower(event.payload, type, actorName);
      case DomainEventType.MESSAGE_RECEIVED:
        return this.renderMessage(event.payload, type, actorName);
    }
  }

  // ─── Per-event copy ────────────────────────────────────────────────────────

  private renderWorkoutCompleted(payload: WorkoutCompletedPayload, type: NotificationType, athleteName: string | null): RenderedNotification {
    const who = displayActor(athleteName, "Your athlete");
    const session = payload.workoutName ? `${who} finished "${payload.workoutName}"` : `${who} finished a workout`;
    return {
      type,
      title: "Workout completed",
      body: session,
      actionUrl: `/workouts/${payload.workoutId}`,
      data: { workoutId: payload.workoutId, workoutName: payload.workoutName, startedAt: payload.startedAt, durationSeconds: payload.durationSeconds }
    };
  }

  private renderPersonalRecord(payload: PersonalRecordAchievedPayload, type: NotificationType): RenderedNotification {
    const label = PR_LABELS[payload.prType] ?? "Personal record";
    const unit = PR_UNITS[payload.prType] ?? "";
    const exercise = payload.exerciseName ?? "an exercise";
    return {
      type,
      title: "New personal record",
      body: `${label} on ${exercise}: ${payload.value}${unit ? ` ${unit}` : ""}`,
      actionUrl: payload.exerciseId ? `/exercises/${payload.exerciseId}/progress` : "/progress",
      data: {
        exerciseId: payload.exerciseId,
        exerciseName: payload.exerciseName,
        prType: payload.prType,
        value: payload.value,
        workoutId: payload.workoutId,
        achievedAt: payload.achievedAt
      }
    };
  }

  private renderCoachInvitation(payload: CoachInvitationReceivedPayload, type: NotificationType): RenderedNotification {
    return {
      type,
      title: "Coach invitation",
      body: `${displayActor(payload.coachName, "A coach")} invited you to train with them`,
      actionUrl: "/coach-clients/invitations",
      data: { relationshipId: payload.relationshipId, coachId: payload.coachId }
    };
  }

  private renderProgramAssigned(payload: ProgramAssignedPayload, type: NotificationType, coachName: string | null): RenderedNotification {
    return {
      type,
      title: "New program assigned",
      body: `${displayActor(coachName, "Your coach")} assigned you "${payload.programName}"`,
      actionUrl: `/programs/assignments/${payload.assignmentId}`,
      data: {
        assignmentId: payload.assignmentId,
        programId: payload.programId,
        programName: payload.programName,
        startDate: payload.startDate,
        endDate: payload.endDate
      }
    };
  }

  private renderComment(payload: CommentAddedPayload, type: NotificationType, actorName: string | null): RenderedNotification {
    return {
      type,
      title: "New comment",
      body: `${displayActor(actorName, "Someone")}: ${excerpt(payload.excerpt)}`,
      actionUrl: `/${payload.targetType}/${payload.targetId}`,
      data: { commentId: payload.commentId, targetType: payload.targetType, targetId: payload.targetId }
    };
  }

  private renderFollower(payload: NewFollowerPayload, type: NotificationType, actorName: string | null): RenderedNotification {
    return {
      type,
      title: "New follower",
      body: `${displayActor(actorName, displayActor(payload.followerName, "Someone"))} started following you`,
      actionUrl: `/users/${payload.followerId}`,
      data: { followerId: payload.followerId }
    };
  }

  private renderMessage(payload: MessageReceivedPayload, type: NotificationType, actorName: string | null): RenderedNotification {
    const sender = displayActor(actorName ?? payload.senderName, "New message");
    return {
      type,
      title: `Message from ${sender}`,
      body: excerpt(payload.excerpt),
      actionUrl: `/messages/${payload.conversationId}`,
      data: { conversationId: payload.conversationId, messageId: payload.messageId, senderName: payload.senderName }
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async resolveActorName(actorId: string | null): Promise<string | null> {
    if (!actorId) return null;
    const user = await this.userRepo.findOne({ where: { id: actorId }, select: { id: true, name: true } });
    return user?.name ?? null;
  }

  /** Batched variant used when a handler needs several names at once. */
  async resolveNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const users = await this.userRepo.find({ where: { id: In(unique) }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
