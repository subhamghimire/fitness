export enum ConversationType {
  DIRECT = "direct",
  GROUP = "group"
}

export enum ConversationParticipantRole {
  OWNER = "owner",
  ADMIN = "admin",
  MEMBER = "member"
}

export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  SYSTEM = "system"
}

export enum MessageDeliveryState {
  SENT = "sent",
  DELIVERED = "delivered",
  READ = "read"
}

/** Roles allowed to add/remove participants and edit group metadata. */
export const CONVERSATION_MODERATOR_ROLES: readonly ConversationParticipantRole[] = Object.freeze([ConversationParticipantRole.OWNER, ConversationParticipantRole.ADMIN]);

export const CONVERSATION_MAX_PARTICIPANTS = 100;
export const CONVERSATION_MAX_PAGE_SIZE = 100;
