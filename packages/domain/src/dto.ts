import { z } from "zod";
import { CONVERSATION_KINDS, MEMBER_ROLES, TASK_STATUSES } from "./constants";
import { PROJECT_COLOR_KEYS } from "./domain";

/**
 * Data transfer objects returned by the backend — to the web app (Server
 * Actions) and to native clients (HTTP API /api/v1). These zod schemas are the
 * single source for:
 *   - the TypeScript types used throughout the web app (z.infer),
 *   - the OpenAPI document (packages/contracts → generated/openapi.json),
 *   - the generated Swift models of the iOS app.
 *
 * Conventions (documented in docs/api/README.md):
 *   - instants: ISO 8601 UTC with milliseconds ("2026-11-06T07:43:29.456Z"),
 *   - calendar days: "YYYY-MM-DD" (no time zone; never converted),
 *   - nullable fields are always present (value or null), never omitted,
 *   - enums are open for clients: unknown values must be tolerated.
 *
 * Every schema carries a stable `id` in `apiRegistry`; it becomes the
 * component/type name in OpenAPI and Swift. Renaming one is a breaking change.
 */
export const apiRegistry = z.registry<{ id: string; description?: string }>();

function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  apiRegistry.add(schema, { id, description });
  return schema;
}

const id = z.uuid();
const instant = z.iso.datetime({ offset: false });
const calendarDay = z.iso.date();

export const TaskStatusSchema = named("TaskStatus", z.enum(TASK_STATUSES), "Board column. Clients must tolerate unknown values.");
export const MemberRoleSchema = named("MemberRole", z.enum(MEMBER_ROLES));
export const ConversationKindSchema = named("ConversationKind", z.enum(CONVERSATION_KINDS));
/** Allowed colour keys when creating/editing a project (responses keep `color` a plain string). */
export const ProjectColorKeySchema = named(
  "ProjectColorKey",
  z.enum(PROJECT_COLOR_KEYS as [string, ...string[]]),
  "Project colour palette key.",
);
export const ReadOnlyReasonSchema = named("ReadOnlyReason", z.enum(["archived", "inactive_partner"]));

export const TaskSchema = named(
  "Task",
  z.object({
    id,
    projectId: id,
    /** @deprecated Groups were removed (2026-11-09). Always null; kept so older app builds keep decoding. */
    groupId: id.nullable(),
    /** Workspace-wide milestone (see Milestone), or null. */
    milestoneId: id.nullable(),
    /**
     * Human-readable issue number, shown as `#42`. Sequential per workspace
     * across all projects, assigned by the server on create, never changes
     * and is never reused. `id` stays the technical identifier (links, API).
     */
    number: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    assigneeId: id.nullable(),
    startDate: calendarDay.nullable(),
    endDate: calendarDay.nullable(),
    /** Sort key within the status column (ascending). */
    position: z.number(),
    createdBy: id,
    createdAt: instant,
    updatedAt: instant,
    /** Incremented on every write (optimistic concurrency). */
    version: z.number().int(),
  }),
);

/**
 * Compact view of a task for `#` references in chat and the `#` picker.
 * Only tasks of the caller's workspace are ever returned.
 */
export const IssueRefSchema = named(
  "IssueRef",
  z.object({
    id,
    /** Shown as `#42`. */
    number: z.number().int().positive(),
    title: z.string(),
    status: TaskStatusSchema,
    projectId: id,
  }),
);

export const TaskLinkSchema = named(
  "TaskLink",
  z.object({
    id,
    taskId: id,
    /** http(s) URL in canonical form. Open in an external browser. */
    url: z.string(),
    /** Optional display name; clients fall back to host + path. */
    title: z.string().nullable(),
    createdBy: id,
    createdAt: instant,
    updatedAt: instant,
  }),
  "External link attached to a task (Google Drive, Figma, GitHub, …).",
);

/** @deprecated Groups were removed (2026-11-09); only referenced by `Project.groups`, which is always empty. */
export const GroupSchema = named(
  "Group",
  z.object({ id, projectId: id, name: z.string(), position: z.number() }),
);

export const ProjectSchema = named(
  "Project",
  z.object({
    id,
    name: z.string(),
    description: z.string(),
    /** Key of the project colour palette (see domain PROJECT_COLORS); unknown keys render grey. */
    color: z.string(),
    archived: z.boolean(),
    /** @deprecated Groups were removed (2026-11-09). Always empty; kept so older app builds keep decoding. */
    groups: z.array(GroupSchema),
  }),
);

export const MilestoneSchema = named(
  "Milestone",
  z.object({
    id,
    name: z.string(),
    description: z.string(),
    /** Target day, or null. */
    dueDate: calendarDay.nullable(),
    /** Completed milestones leave the navigation; their tasks stay attached. */
    completed: z.boolean(),
    /** Tasks attached (non-archived projects only) and how many of them are done. */
    total: z.number().int(),
    done: z.number().int(),
    createdAt: instant,
  }),
  "Workspace-wide milestone; tasks of any project can be attached via Task.milestoneId.",
);

export const ProjectStatSchema = named("ProjectStat", z.object({ total: z.number().int(), done: z.number().int() }));

export const MemberSchema = named(
  "Member",
  z.object({
    userId: id,
    email: z.string(),
    fullName: z.string().nullable(),
    role: MemberRoleSchema,
    active: z.boolean(),
  }),
);

export const InvitationSchema = named(
  "Invitation",
  z.object({
    id,
    email: z.string(),
    role: MemberRoleSchema,
    expiresAt: instant,
    lastSentAt: instant,
    expired: z.boolean(),
  }),
);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const ChatPersonSchema = named(
  "ChatPerson",
  z.object({ userId: id, fullName: z.string().nullable(), email: z.string(), active: z.boolean() }),
);

const conversationSummaryShape = {
  id,
  kind: ConversationKindSchema,
  /** Channel name; for DMs the partner's display name (computed per viewer). */
  title: z.string(),
  description: z.string(),
  archived: z.boolean(),
  isDefault: z.boolean(),
  ownerId: id.nullable(),
  lastMessageAt: instant.nullable(),
  lastMessageSeq: z.number().int(),
  lastReadSeq: z.number().int(),
  unread: z.boolean(),
  dmPartner: ChatPersonSchema.nullable(),
};

export const ConversationSummarySchema = named("ConversationSummary", z.object(conversationSummaryShape));

export const ConversationDetailSchema = named(
  "ConversationDetail",
  z.object({
    ...conversationSummaryShape,
    createdBy: id.nullable(),
    createdAt: instant,
    /** Explicit participants (private channels, DMs). Empty for open channels. */
    members: z.array(ChatPersonSchema),
    canPost: z.boolean(),
    readOnlyReason: ReadOnlyReasonSchema.nullable(),
    canManage: z.boolean(),
  }),
);

export const AttachmentSchema = named(
  "Attachment",
  z.object({ id, fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int() }),
);

export const MessageSchema = named(
  "Message",
  z.object({
    id,
    /** Monotonic order within the workspace; cursor for pagination. */
    seq: z.number().int(),
    conversationId: id,
    authorId: id,
    /** Readable text: mentions appear as "@Current Name". Safe to display as is. */
    body: z.string(),
    createdAt: instant,
    editedAt: instant.nullable(),
    deleted: z.boolean(),
    attachments: z.array(AttachmentSchema),
    /**
     * Stored text with mention tokens `<@user-uuid>` (see @vistoo/domain/mentions).
     * Clients that render or edit mentions use this instead of `body`; sending
     * or editing accepts the same format.
     */
    markup: z.string(),
    /** Distinct user ids mentioned in the message (resolve names via `authors`). */
    mentionIds: z.array(id),
    /**
     * Tasks referenced with `<#task-id>` tokens in `markup`, resolved for the
     * reader (only tasks of the workspace that still exist). A token whose id
     * is missing here points to a deleted task. `body` shows them as `#24`.
     */
    issueRefs: z.array(IssueRefSchema),
  }),
);

export const ChatStorageUsageSchema = named(
  "ChatStorageUsage",
  z.object({ usedBytes: z.number().int(), budgetBytes: z.number().int(), ratio: z.number() }),
);

export const UploadTicketSchema = named(
  "UploadTicket",
  z.object({
    attachmentId: id,
    /** Short-lived signed URL. Upload with HTTP PUT, body = file bytes, headers `content-type` and `x-upsert: false`. */
    signedUrl: z.string(),
    contentType: z.string(),
  }),
);

export const NotificationSettingsSchema = named(
  "NotificationSettings",
  z.object({
    /** Push for direct messages to me. */
    directMessages: z.boolean(),
    /** Push for messages in channels I can read (open channels and my private channels). */
    channelMessages: z.boolean(),
    /** Push when a task is assigned to me by someone else. */
    taskAssignments: z.boolean(),
  }),
);

export const NotificationKindSchema = named("NotificationKind", z.enum(["mention"]));

/** Persistent in-app notification (currently: someone mentioned me in a chat message). */
export const NotificationSchema = named(
  "Notification",
  z.object({
    id,
    kind: NotificationKindSchema,
    /** Who caused it (null if the profile no longer exists). */
    actor: ChatPersonSchema.nullable(),
    conversationId: id,
    /** Channel name or, for DMs, the partner's display name (as seen by the recipient). */
    conversationTitle: z.string(),
    conversationKind: ConversationKindSchema,
    messageId: id,
    /** Readable message preview (mentions as "@Name"); empty if the message was deleted. */
    preview: z.string(),
    createdAt: instant,
    readAt: instant.nullable(),
  }),
);

export const NotificationPageSchema = named(
  "NotificationPage",
  z.object({ notifications: z.array(NotificationSchema), unreadCount: z.number().int() }),
);

export type TaskDTO = z.infer<typeof TaskSchema>;
export type TaskLinkDTO = z.infer<typeof TaskLinkSchema>;
export type IssueRefDTO = z.infer<typeof IssueRefSchema>;
export type GroupDTO = z.infer<typeof GroupSchema>;
export type ProjectDTO = z.infer<typeof ProjectSchema>;
export type MilestoneDTO = z.infer<typeof MilestoneSchema>;
export type MemberDTO = z.infer<typeof MemberSchema>;
export type InvitationDTO = z.infer<typeof InvitationSchema>;
export type ChatPerson = z.infer<typeof ChatPersonSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
export type AttachmentDTO = z.infer<typeof AttachmentSchema>;
export type MessageDTO = z.infer<typeof MessageSchema>;
export type ChatStorageUsage = z.infer<typeof ChatStorageUsageSchema>;
export type UploadTicket = z.infer<typeof UploadTicketSchema>;
export type NotificationSettingsDTO = z.infer<typeof NotificationSettingsSchema>;
export type NotificationDTO = z.infer<typeof NotificationSchema>;
export type NotificationPageDTO = z.infer<typeof NotificationPageSchema>;
