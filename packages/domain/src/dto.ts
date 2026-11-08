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
    groupId: id.nullable(),
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
    groups: z.array(GroupSchema),
  }),
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
    body: z.string(),
    createdAt: instant,
    editedAt: instant.nullable(),
    deleted: z.boolean(),
    attachments: z.array(AttachmentSchema),
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

export type TaskDTO = z.infer<typeof TaskSchema>;
export type TaskLinkDTO = z.infer<typeof TaskLinkSchema>;
export type GroupDTO = z.infer<typeof GroupSchema>;
export type ProjectDTO = z.infer<typeof ProjectSchema>;
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
