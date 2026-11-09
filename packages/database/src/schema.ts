import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ACTIVITY_TYPES, ATTRACTION_STATUSES, type ActivityMetadata } from "@vistoo/domain/crm";
import { IDEA_STATUSES } from "@vistoo/domain/ideas";
import { DECISION_STATUSES, DECISION_TYPES, HISTORY_KINDS, type HistoryDetails } from "@vistoo/domain/decisions";

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
  /** Join link for team meetings (e.g. a Discord voice channel). Set by admins. */
  meetingUrl: text("meeting_url"),
  ...timestamps,
}, (t) => [
  check("workspaces_meeting_url_web", sql`${t.meetingUrl} is null or ${t.meetingUrl} ~* '^https?://'`),
  check("workspaces_meeting_url_len", sql`${t.meetingUrl} is null or char_length(${t.meetingUrl}) <= 2048`),
]);

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

/**
 * Workspace-wide milestones (e.g. "Launch v1"). Issues of any project can be
 * attached to one. Completed milestones leave the navigation but keep their
 * issues. Deleting one detaches its issues (service layer).
 */
export const milestones = pgTable(
  "milestones",
  {
    /** Client-generated on create: makes retries idempotent. */
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Target day (calendar day, no time zone). */
    dueDate: date("due_date", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id),
    ...timestamps,
  },
  (t) => [
    unique("milestones_workspace_id_id_uq").on(t.workspaceId, t.id),
    index("milestones_workspace_idx").on(t.workspaceId),
    check("milestones_name_len", sql`char_length(${t.name}) between 1 and 120`),
    check("milestones_description_len", sql`char_length(${t.description}) <= 500`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    milestoneId: uuid("milestone_id"),
    /**
     * Human-readable issue number (`#42`), sequential per workspace across all
     * projects. Always assigned by the `tasks_assign_number` trigger from
     * `task_number_counters` (any value sent on insert is ignored, the default
     * only satisfies the insert type) and immutable afterwards. Numbers of
     * deleted tasks are never reused. The UUID stays the technical id.
     */
    number: integer("number").notNull().default(0),
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
    // Assignee must be a member of the task's workspace (active-ness is
    // enforced by trigger, see security migration).
    foreignKey({
      name: "tasks_assignee_fk",
      columns: [t.workspaceId, t.assigneeId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    // Milestone must belong to the task's workspace. Deleting a milestone
    // detaches its tasks first (service layer), so no ON DELETE action.
    foreignKey({
      name: "tasks_milestone_fk",
      columns: [t.workspaceId, t.milestoneId],
      foreignColumns: [milestones.workspaceId, milestones.id],
    }),
    unique("tasks_workspace_id_id_uq").on(t.workspaceId, t.id),
    unique("tasks_workspace_number_uq").on(t.workspaceId, t.number),
    check("tasks_number_positive", sql`${t.number} > 0`),
    check("tasks_title_len", sql`char_length(${t.title}) between 1 and 300`),
    check("tasks_description_len", sql`char_length(${t.description}) <= 20000`),
    check(
      "tasks_date_range",
      sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    index("tasks_workspace_status_position_idx").on(t.workspaceId, t.status, t.position),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_milestone_idx").on(t.milestoneId),
    index("tasks_assignee_idx").on(t.workspaceId, t.assigneeId),
  ],
);

/**
 * Last issue number handed out per workspace. Only the `tasks_assign_number`
 * trigger writes here (upsert + increment under the row lock), so concurrent
 * inserts are serialized per workspace and the counter never goes back.
 */
export const taskNumberCounters = pgTable(
  "task_number_counters",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    lastNumber: integer("last_number").notNull(),
  },
  (t) => [check("task_number_counters_positive", sql`${t.lastNumber} > 0`)],
);

/**
 * External links attached to a task (Google Drive, Figma, GitHub, …). Files
 * themselves stay in Google Drive; only the URL is stored. Deleted with the task.
 */
export const taskLinks = pgTable(
  "task_links",
  {
    /** Client-generated on create: makes retries idempotent. */
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "task_links_task_fk",
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete("cascade"),
    index("task_links_task_idx").on(t.taskId, t.createdAt),
    // Defence in depth: the service validates the URL, the database only accepts http(s).
    check("task_links_url_web", sql`${t.url} ~* '^https?://'`),
    check("task_links_url_len", sql`char_length(${t.url}) <= 2048`),
    check("task_links_title_len", sql`${t.title} is null or char_length(${t.title}) between 1 and 200`),
  ],
);

// ---------------------------------------------------------------------------
// Personal to-dos, ideas, CRM
// ---------------------------------------------------------------------------

/** Private checklist per member ("Meine To-dos"). Not related to projects or tasks. */
export const personalTodos = pgTable(
  "personal_todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }),
    /** null = open. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Sort key among the owner's open to-dos (ascending). */
    position: doublePrecision("position").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "personal_todos_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    index("personal_todos_owner_idx").on(t.workspaceId, t.userId, t.position),
    check("personal_todos_title_len", sql`char_length(${t.title}) between 1 and 300`),
    check("personal_todos_description_len", sql`char_length(${t.description}) <= 5000`),
  ],
);

export const ideaStatus = pgEnum("idea_status", IDEA_STATUSES);

/** Shared idea backlog. */
export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: ideaStatus("status").notNull().default("new"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    assigneeId: uuid("assignee_id"),
    /** Issue created from this idea; cleared when the task is deleted. Same workspace (service). */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "ideas_assignee_fk",
      columns: [t.workspaceId, t.assigneeId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    // Target of same-workspace foreign keys (decision_relations).
    unique("ideas_workspace_id_id_uq").on(t.workspaceId, t.id),
    index("ideas_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("ideas_task_idx").on(t.taskId),
    check("ideas_title_len", sql`char_length(${t.title}) between 1 and 300`),
    check("ideas_description_len", sql`char_length(${t.description}) <= 20000`),
  ],
);

export const attractionStatus = pgEnum("attraction_status", ATTRACTION_STATUSES);
export const attractionActivityType = pgEnum("attraction_activity_type", ACTIVITY_TYPES);

/** CRM: potential partner attractions. */
export const attractions = pgTable(
  "attractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city"),
    country: text("country"),
    website: text("website"),
    email: text("email"),
    contactName: text("contact_name"),
    status: attractionStatus("status").notNull().default("new"),
    ownerId: uuid("owner_id"),
    notes: text("notes").notNull().default(""),
    /** Calendar day (no time zone). */
    nextFollowUp: date("next_follow_up", { mode: "string" }),
    /** Denormalized: latest call / e-mail / meeting activity. */
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    ...timestamps,
  },
  (t) => [
    unique("attractions_workspace_id_id_uq").on(t.workspaceId, t.id),
    foreignKey({
      name: "attractions_owner_fk",
      columns: [t.workspaceId, t.ownerId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    index("attractions_workspace_idx").on(t.workspaceId),
    check("attractions_name_len", sql`char_length(${t.name}) between 1 and 200`),
    check(
      "attractions_short_text_len",
      sql`coalesce(char_length(${t.city}), 0) <= 200 and coalesce(char_length(${t.country}), 0) <= 200
        and coalesce(char_length(${t.contactName}), 0) <= 200 and coalesce(char_length(${t.email}), 0) <= 2048`,
    ),
    check("attractions_website_web", sql`${t.website} is null or (${t.website} ~* '^https?://' and char_length(${t.website}) <= 2048)`),
    check("attractions_notes_len", sql`char_length(${t.notes}) <= 20000`),
  ],
);

/**
 * Activity timeline of an attraction. System entries (created, status/owner/
 * follow-up changes) are written by the service in the same transaction as
 * the change and are immutable (trigger); manual entries can be edited.
 */
export const attractionActivities = pgTable(
  "attraction_activities",
  {
    /** Client-generated for manual entries: makes retries idempotent. */
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    attractionId: uuid("attraction_id").notNull(),
    type: attractionActivityType("type").notNull(),
    description: text("description").notNull().default(""),
    /** System entries: { from, to } (status keys, user ids or calendar days). */
    metadata: jsonb("metadata").$type<ActivityMetadata>().notNull().default({}),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "attraction_activities_attraction_fk",
      columns: [t.workspaceId, t.attractionId],
      foreignColumns: [attractions.workspaceId, attractions.id],
    }).onDelete("cascade"),
    index("attraction_activities_timeline_idx").on(t.attractionId, t.occurredAt),
    check("attraction_activities_description_len", sql`char_length(${t.description}) <= 5000`),
  ],
);

// ---------------------------------------------------------------------------
// Decisions & experiments
// ---------------------------------------------------------------------------

export const decisionType = pgEnum("decision_type", DECISION_TYPES);
export const decisionStatus = pgEnum("decision_status", DECISION_STATUSES);
export const decisionHistoryKind = pgEnum("decision_history_kind", HISTORY_KINDS);

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Decisions and experiments ("Decisions"). One record for both types; the
 * status must belong to the type. Concluded entries always carry a result
 * and reasoning (service + CHECK). A superseded decision points to the
 * decision that replaced it; the reverse direction is derived.
 */
export const decisions = pgTable(
  "decisions",
  {
    /** Client-generated on create: makes retries idempotent. */
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: decisionType("type").notNull(),
    title: text("title").notNull(),
    /** Context (decision) / description (experiment). */
    description: text("description").notNull().default(""),
    status: decisionStatus("status").notNull(),
    assigneeId: uuid("assignee_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    optionsConsidered: text("options_considered").notNull().default(""),
    objective: text("objective").notNull().default(""),
    testDescription: text("test_description").notNull().default(""),
    results: text("results").notNull().default(""),
    /** Final decision (decision) / conclusion (experiment). */
    outcome: text("outcome").notNull().default(""),
    reasoning: text("reasoning").notNull().default(""),
    /** Day of the decision / end of the experiment; set for concluded entries only. */
    concludedOn: date("concluded_on", { mode: "string" }),
    supersededById: uuid("superseded_by_id"),
    /** Full-text search over all written content ('simple': no language stemming, mixed DE/EN). */
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, title || ' ' || description || ' ' || options_considered || ' ' || objective || ' ' || test_description || ' ' || results || ' ' || outcome || ' ' || reasoning)`,
    ),
    ...timestamps,
  },
  (t) => [
    unique("decisions_workspace_id_id_uq").on(t.workspaceId, t.id),
    foreignKey({
      name: "decisions_assignee_fk",
      columns: [t.workspaceId, t.assigneeId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }),
    // Successor in the same workspace. Deleting it is handled by the service
    // (the replaced decision becomes current again), so no ON DELETE action.
    foreignKey({
      name: "decisions_superseded_by_fk",
      columns: [t.workspaceId, t.supersededById],
      foreignColumns: [t.workspaceId, t.id],
    }),
    index("decisions_workspace_updated_idx").on(t.workspaceId, t.updatedAt),
    index("decisions_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("decisions_superseded_by_idx").on(t.supersededById),
    index("decisions_search_idx").using("gin", t.search),
    check(
      "decisions_status_matches_type",
      sql`(${t.type} = 'decision' and ${t.status} in ('open', 'in_discussion', 'decided', 'superseded'))
        or (${t.type} = 'experiment' and ${t.status} in ('planned', 'testing', 'adopted', 'rejected', 'inconclusive'))`,
    ),
    check("decisions_title_len", sql`char_length(${t.title}) between 1 and 300`),
    check(
      "decisions_text_len",
      sql`char_length(${t.description}) <= 20000 and char_length(${t.optionsConsidered}) <= 20000
        and char_length(${t.objective}) <= 20000 and char_length(${t.testDescription}) <= 20000
        and char_length(${t.results}) <= 20000 and char_length(${t.outcome}) <= 20000
        and char_length(${t.reasoning}) <= 20000`,
    ),
    // Concluded ⇔ has a day; decisions document outcome + reasoning, experiments their result.
    check(
      "decisions_concluded_complete",
      sql`case when ${t.status} in ('decided', 'superseded', 'adopted', 'rejected', 'inconclusive')
        then ${t.concludedOn} is not null
          and (case when ${t.type} = 'experiment' then btrim(${t.results}) <> ''
            else btrim(${t.outcome}) <> '' and btrim(${t.reasoning}) <> '' end)
        else ${t.concludedOn} is null end`,
    ),
    check("decisions_superseded_link", sql`(${t.status} = 'superseded') = (${t.supersededById} is not null)`),
    check("decisions_not_self_superseded", sql`${t.supersededById} is null or ${t.supersededById} <> ${t.id}`),
  ],
);

/** External references of a decision (GitHub, Google Docs, benchmarks …). Same rules as task links. */
export const decisionLinks = pgTable(
  "decision_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "decision_links_decision_fk",
      columns: [t.workspaceId, t.decisionId],
      foreignColumns: [decisions.workspaceId, decisions.id],
    }).onDelete("cascade"),
    index("decision_links_decision_idx").on(t.decisionId, t.createdAt),
    check("decision_links_url_web", sql`${t.url} ~* '^https?://'`),
    check("decision_links_url_len", sql`char_length(${t.url}) <= 2048`),
    check("decision_links_title_len", sql`${t.title} is null or char_length(${t.title}) between 1 and 200`),
  ],
);

/**
 * Links from a decision to existing issues (tasks) or ideas. Exactly one
 * target; same workspace enforced by the composite keys; removed together
 * with the decision or the target.
 */
export const decisionRelations = pgTable(
  "decision_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    taskId: uuid("task_id"),
    ideaId: uuid("idea_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "decision_relations_decision_fk",
      columns: [t.workspaceId, t.decisionId],
      foreignColumns: [decisions.workspaceId, decisions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "decision_relations_task_fk",
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "decision_relations_idea_fk",
      columns: [t.workspaceId, t.ideaId],
      foreignColumns: [ideas.workspaceId, ideas.id],
    }).onDelete("cascade"),
    uniqueIndex("decision_relations_task_uq").on(t.decisionId, t.taskId),
    uniqueIndex("decision_relations_idea_uq").on(t.decisionId, t.ideaId),
    index("decision_relations_task_idx").on(t.taskId),
    index("decision_relations_idea_idx").on(t.ideaId),
    check("decision_relations_one_target", sql`num_nonnulls(${t.taskId}, ${t.ideaId}) = 1`),
  ],
);

/**
 * Slim audit trail of concluded entries: who changed which documented fields
 * when (with the previous values), plus concluding, reopening and replacing.
 * Append-only (trigger); removed only together with the decision.
 */
export const decisionHistory = pgTable(
  "decision_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    kind: decisionHistoryKind("kind").notNull(),
    details: jsonb("details").$type<HistoryDetails>().notNull().default({}),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "decision_history_decision_fk",
      columns: [t.workspaceId, t.decisionId],
      foreignColumns: [decisions.workspaceId, decisions.id],
    }).onDelete("cascade"),
    index("decision_history_decision_idx").on(t.decisionId, t.createdAt),
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

// ---------------------------------------------------------------------------
// Push notifications (native apps)
// ---------------------------------------------------------------------------

export const pushEnvironment = pgEnum("push_environment", ["sandbox", "production"]);

/**
 * APNs device tokens. One row per device; re-registering a token from another
 * account moves it (account switch on the same iPhone). Server-only table.
 */
export const pushDevices = pgTable(
  "push_devices",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("ios"),
    environment: pushEnvironment("environment").notNull(),
    ...timestamps,
  },
  (t) => [
    index("push_devices_user_idx").on(t.userId),
    check("push_devices_token_len", sql`char_length(${t.token}) between 8 and 200`),
  ],
);

/** Which events notify a user (missing row = all enabled). */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  directMessages: boolean("direct_messages").notNull().default(true),
  channelMessages: boolean("channel_messages").notNull().default(true),
  taskAssignments: boolean("task_assignments").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// In-app notifications (currently: chat mentions)
// ---------------------------------------------------------------------------

export const notificationKind = pgEnum("notification_kind", ["mention"]);

/**
 * Persistent in-app notifications. Written only by the server; recipients may
 * SELECT their own rows (Realtime badge). One row per (message, recipient,
 * kind): a message never notifies the same person twice, also not on edits.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    actorId: uuid("actor_id").references(() => profiles.id),
    kind: notificationKind("kind").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "notifications_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_message_fk",
      columns: [t.conversationId, t.messageId],
      foreignColumns: [messages.conversationId, messages.id],
    }).onDelete("cascade"),
    uniqueIndex("notifications_message_user_kind_uq").on(t.messageId, t.userId, t.kind),
    index("notifications_user_created_idx").on(t.userId, t.workspaceId, t.createdAt),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskLink = typeof taskLinks.$inferSelect;
export type PersonalTodo = typeof personalTodos.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type Attraction = typeof attractions.$inferSelect;
export type AttractionActivity = typeof attractionActivities.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type DecisionLink = typeof decisionLinks.$inferSelect;
export type DecisionHistory = typeof decisionHistory.$inferSelect;
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type MemberRole = (typeof memberRole.enumValues)[number];
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
