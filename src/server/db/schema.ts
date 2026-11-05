import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Application schema. Drizzle is the single source of truth for tables,
 * constraints and indexes. Security-related SQL (RLS, helper functions,
 * triggers, realtime publication) lives in a custom migration in the same
 * drizzle migration chain (see drizzle/).
 */

export const memberRole = pgEnum("member_role", ["admin", "member"]);
export const memberStatus = pgEnum("member_status", ["active", "removed"]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);
export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "in_review",
  "done",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** One row per Supabase auth user that ever joined a workspace. Never deleted, so creator history stays intact. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // = auth.users.id
  email: text("email").notNull(),
  fullName: text("full_name"),
  ...timestamps,
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    role: memberRole("role").notNull().default("member"),
    status: memberStatus("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Always stored lower-cased. */
    email: text("email").notNull(),
    role: memberRole("role").notNull().default("member"),
    status: invitationStatus("status").notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => profiles.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => profiles.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("workspace_invitations_email_lower", sql`${t.email} = lower(${t.email})`),
    uniqueIndex("workspace_invitations_pending_email_uq")
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index("workspace_invitations_email_idx").on(t.email),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("slate"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id),
    ...timestamps,
  },
  (t) => [
    unique("projects_workspace_id_id_uq").on(t.workspaceId, t.id),
    index("projects_workspace_idx").on(t.workspaceId),
    check("projects_name_len", sql`char_length(${t.name}) between 1 and 120`),
    check("projects_description_len", sql`char_length(${t.description}) <= 500`),
  ],
);

export const projectGroups = pgTable(
  "project_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    position: doublePrecision("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "project_groups_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    unique("project_groups_project_id_id_uq").on(t.projectId, t.id),
    uniqueIndex("project_groups_project_name_uq").on(t.projectId, sql`lower(${t.name})`),
    check("project_groups_name_len", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    groupId: uuid("group_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatus("status").notNull().default("open"),
    assigneeId: uuid("assignee_id"),
    /** Calendar days (no time zone). */
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    /** Sort key within the status column (fractional ordering). */
    position: doublePrecision("position").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    updatedBy: uuid("updated_by").references(() => profiles.id),
    /** Incremented on every write; used for optimistic concurrency control. */
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "tasks_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    // Group must belong to the same project. Deleting a group is handled in
    // the service layer (tasks are detached first), so no ON DELETE action.
    foreignKey({
      name: "tasks_group_fk",
      columns: [t.projectId, t.groupId],
      foreignColumns: [projectGroups.projectId, projectGroups.id],
    }),
    // Assignee must be a member of the task's workspace (active-ness is
    // enforced by trigger, see security migration).
    foreignKey({
      name: "tasks_assignee_fk",
      columns: [t.workspaceId, t.assigneeId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    check("tasks_title_len", sql`char_length(${t.title}) between 1 and 300`),
    check("tasks_description_len", sql`char_length(${t.description}) <= 20000`),
    check(
      "tasks_date_range",
      sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    index("tasks_workspace_status_position_idx").on(t.workspaceId, t.status, t.position),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_group_idx").on(t.groupId),
    index("tasks_assignee_idx").on(t.workspaceId, t.assigneeId),
  ],
);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const conversationKind = pgEnum("conversation_kind", ["open_channel", "private_channel", "dm"]);
/**
 * Attachment lifecycle. A "reserved" row doubles as the upload reservation
 * (counts against the workspace budget until it expires or is finalized).
 */
export const attachmentStatus = pgEnum("attachment_status", ["reserved", "uploaded", "attached", "deleting"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: conversationKind("kind").notNull(),
    /** Channels only. */
    name: text("name"),
    description: text("description").notNull().default(""),
    /** DMs only: "<lower uuid>:<higher uuid>" – one DM per pair and workspace. */
    dmKey: text("dm_key"),
    /** The idempotently created open channel "Allgemein". */
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: uuid("created_by").references(() => profiles.id),
    /** Responsible member (channels). */
    ownerId: uuid("owner_id").references(() => profiles.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Denormalized for list ordering and unread detection. */
    lastMessageSeq: bigint("last_message_seq", { mode: "number" }).notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("conversations_workspace_id_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("conversations_dm_key_uq").on(t.workspaceId, t.dmKey).where(sql`${t.dmKey} is not null`),
    uniqueIndex("conversations_channel_name_uq")
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.kind} <> 'dm'`),
    uniqueIndex("conversations_default_uq").on(t.workspaceId).where(sql`${t.isDefault}`),
    index("conversations_workspace_idx").on(t.workspaceId),
    check(
      "conversations_kind_shape",
      sql`(${t.kind} = 'dm' and ${t.name} is null and ${t.dmKey} is not null)
        or (${t.kind} <> 'dm' and ${t.name} is not null and ${t.dmKey} is null)`,
    ),
    check("conversations_name_len", sql`${t.name} is null or char_length(${t.name}) between 1 and 80`),
    check("conversations_description_len", sql`char_length(${t.description}) <= 500`),
    check("conversations_default_open", sql`not ${t.isDefault} or ${t.kind} = 'open_channel'`),
  ],
);

/** Explicit participants: private channels and DMs (open channels need none). */
export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    addedBy: uuid("added_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    foreignKey({
      name: "conversation_members_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_members_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    index("conversation_members_user_idx").on(t.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    /** Generated by the client: makes sending idempotent. */
    id: uuid("id").primaryKey(),
    /** Monotonic order + cursor (unique tie-breaker). */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    conversationId: uuid("conversation_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id),
    body: text("body").notNull().default(""),
    attachmentCount: integer("attachment_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("messages_seq_uq").on(t.seq),
    unique("messages_conversation_id_id_uq").on(t.conversationId, t.id),
    foreignKey({
      name: "messages_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    index("messages_conversation_seq_idx").on(t.conversationId, t.seq),
    check("messages_body_len", sql`char_length(${t.body}) <= 10000`),
    check("messages_deleted_empty", sql`${t.deletedAt} is null or (${t.body} = '' and ${t.attachmentCount} = 0)`),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id"),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => profiles.id),
    /** Random path inside the private bucket; never derived from the file name. */
    storagePath: text("storage_path").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: attachmentStatus("status").notNull().default("reserved"),
    /** Reservation / unattached-upload deadline for cleanup. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "message_attachments_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "message_attachments_message_fk",
      columns: [t.conversationId, t.messageId],
      foreignColumns: [messages.conversationId, messages.id],
    }),
    index("message_attachments_workspace_status_idx").on(t.workspaceId, t.status),
    index("message_attachments_message_idx").on(t.messageId),
    check("message_attachments_size", sql`${t.sizeBytes} > 0`),
    check("message_attachments_name_len", sql`char_length(${t.fileName}) between 1 and 255`),
    check(
      "message_attachments_attached_has_message",
      sql`(${t.status} = 'attached') = (${t.messageId} is not null) or ${t.status} = 'deleting'`,
    ),
  ],
);

/** Last read position per member and conversation (no per-message receipts). */
export const conversationReadStates = pgTable(
  "conversation_read_states",
  {
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    workspaceId: uuid("workspace_id").notNull(),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    foreignKey({
      name: "conversation_read_states_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectGroup = typeof projectGroups.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type MemberRole = (typeof memberRole.enumValues)[number];
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
