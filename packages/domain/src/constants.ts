/** Enumerations shared by DTO schemas, validation and UI (no imports: avoids cycles). */

/** Board columns, left to right. `backlog` = collected, not yet planned (added 2026-11-12, after `open` in the enum). */
export const TASK_STATUSES = ["backlog", "open", "in_progress", "in_review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Most people a task can be assigned to at once. */
export const MAX_TASK_ASSIGNEES = 20;

export const MEMBER_ROLES = ["admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CONVERSATION_KINDS = ["open_channel", "private_channel", "dm"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
