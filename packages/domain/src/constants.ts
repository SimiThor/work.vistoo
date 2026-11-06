/** Enumerations shared by DTO schemas, validation and UI (no imports: avoids cycles). */

export const TASK_STATUSES = ["open", "in_progress", "in_review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MEMBER_ROLES = ["admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CONVERSATION_KINDS = ["open_channel", "private_channel", "dm"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
