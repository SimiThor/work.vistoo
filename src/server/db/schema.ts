import { sql } from "drizzle-orm";
import {
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

export type Profile = typeof profiles.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectGroup = typeof projectGroups.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type MemberRole = (typeof memberRole.enumValues)[number];
