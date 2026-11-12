import { z } from "zod";
import { INVITATION_TTL_DAYS } from "@vistoo/domain";
import { ALLOWED_FILE_TYPES, CHAT_LIMITS } from "@vistoo/domain/chat-config";
import {
  apiRegistry,
  ChatPersonSchema,
  ChatStorageUsageSchema,
  ConversationDetailSchema,
  ConversationSummarySchema,
  InvitationSchema,
  MemberRoleSchema,
  MemberSchema,
  MessageSchema,
  MilestoneSchema,
  ProjectSchema,
  ProjectStatSchema,
  TaskLinkSchema,
  TaskSchema,
  IssueRefSchema,
  UploadTicketSchema,
  NotificationPageSchema,
  NotificationSettingsSchema,
  TodoSchema,
  IdeaSchema,
  AttractionSchema,
  ActivitySchema,
  DecisionTypeSchema,
  DecisionStatusSchema,
  DecisionSortSchema,
  DecisionSummarySchema,
  DecisionDetailSchema,
  DecisionRefSchema,
  DecisionLinkSchema,
  DecisionRelationSchema,
  RelationCandidateSchema,
} from "@vistoo/domain/dto";
import { ERROR_CODES, type ErrorCode } from "@vistoo/domain/result";
import * as v from "@vistoo/domain/validation";
import { createActivitySchema, createAttractionSchema, updateActivitySchema, updateAttractionSchema } from "@vistoo/domain/crm";
import {
  addDecisionRelationSchema,
  createDecisionLinkSchema,
  createDecisionSchema,
  DECISION_LIMITS,
  decisionPatchSchema,
  supersedeRequestSchema,
  updateDecisionLinkSchema,
} from "@vistoo/domain/decisions";
import { createIdeaSchema, updateIdeaSchema } from "@vistoo/domain/ideas";
import { createTodoSchema, reorderTodosSchema, updateTodoSchema } from "@vistoo/domain/todos";

/**
 * HTTP API v1 for native clients (iOS). Single source of truth for:
 *   - request validation and response shapes in the server (packages/backend/src/http),
 *   - generated/openapi.json (OpenAPI 3.1, `npm run generate`),
 *   - the generated Swift models and endpoint descriptors of the iOS app.
 *
 * Compatibility rules (docs/architecture/releases.md):
 *   - additive changes only within v1 (new endpoints, new optional request
 *     fields, new response fields, new enum values),
 *   - never remove/rename a field or change its type in v1,
 *   - a breaking change means /api/v2 next to v1 until old apps are gone.
 */

export const API_VERSION = "1";
export const API_BASE_PATH = "/api/v1";

/**
 * - public: no token,
 * - session: valid Supabase access token, membership not required (onboarding),
 * - member: active workspace member (re-checked on every request),
 * - admin: active member with role admin.
 */
export type AuthLevel = "public" | "session" | "member" | "admin";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type EndpointDef = {
  method: HttpMethod;
  /** Relative to API_BASE_PATH, with {param} placeholders. */
  path: string;
  tag:
    | "Meta"
    | "Session"
    | "Tasks"
    | "Projects"
    | "Milestones"
    | "Todos"
    | "Ideas"
    | "CRM"
    | "Decisions"
    | "Team"
    | "Chat"
    | "Files";
  summary: string;
  description?: string;
  auth: AuthLevel;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** null → 204 No Content. */
  response: z.ZodType | null;
  status?: 200 | 201 | 202;
  /** Error codes this endpoint can return (in addition to INTERNAL / CLIENT_OUTDATED). */
  errors: readonly ErrorCode[];
  /** How a client can safely retry this request after a network failure. */
  retry: "safe" | "idempotent-with-client-id" | "check-conflict" | "not-found-means-done";
};

/** Request/response schemas get stable names (OpenAPI components, Swift types). */
export const requestRegistry = z.registry<{ id: string; description?: string }>();
function req<T extends z.ZodType>(id: string, schema: T): T {
  requestRegistry.add(schema, { id });
  return schema;
}
function res<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  apiRegistry.add(schema, { id, description });
  return schema;
}

const idParam = z.object({ id: v.uuid });
const SetArchivedRequest = req("SetArchivedRequest", z.object({ archived: z.boolean() }));
const ConversationRef = res("ConversationRef", z.object({ id: v.uuid }));
const instant = z.iso.datetime({ offset: false });
const ActivityChange = res("ActivityChange", z.object({ attraction: AttractionSchema, activity: ActivitySchema }));

// ---------------------------------------------------------------------------
// Shared response objects
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = res("ErrorCode", z.enum(ERROR_CODES), "Clients must tolerate unknown codes (treat as INTERNAL).");
export const ErrorResponseSchema = res(
  "ErrorResponse",
  z.object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().describe("German, user-facing. Show as is."),
      fieldErrors: z.record(z.string(), z.string()).optional(),
      /** CONFLICT on task updates: the current server version of the task. */
      current: TaskSchema.optional(),
    }),
  }),
);

export const MetaSchema = res(
  "Meta",
  z.object({
    apiVersion: z.string(),
    environment: z.string().describe("e.g. production, preview, development"),
    supabaseUrl: z.string().describe("Clients use exactly this Supabase project for Auth/Realtime."),
    supabasePublishableKey: z.string(),
    minimumIosBuild: z.number().int().describe("Older iOS builds get CLIENT_OUTDATED and must update."),
  }),
);

export const LimitsSchema = res(
  "Limits",
  z.object({
    maxMessageLength: z.number().int(),
    messagePageSize: z.number().int(),
    maxFileBytes: z.number().int(),
    maxFilesPerMessage: z.number().int(),
    allowedFileTypes: z.array(
      z.object({ label: z.string(), extensions: z.array(z.string()), mimeType: z.string() }),
    ),
    invitationTtlDays: z.number().int(),
  }),
);

export const ViewerSchema = res(
  "Viewer",
  z.object({
    userId: v.uuid,
    email: z.string(),
    fullName: z.string().nullable(),
    role: MemberRoleSchema,
    workspaceId: v.uuid,
    workspaceName: z.string(),
    meetingUrl: z.string().nullable().describe("Join link for team meetings (Discord voice channel). Null until an admin sets it."),
  }),
);

export const MeSchema = res(
  "Me",
  z.object({
    userId: v.uuid,
    email: z.string(),
    fullName: z.string().nullable(),
    /** member: full access; invited: show acceptance; expired/none: no access. */
    access: z.enum(["member", "invited", "expired", "none"]),
    viewer: ViewerSchema.nullable(),
    invitation: z
      .object({ id: v.uuid, role: MemberRoleSchema, workspaceName: z.string(), expiresAt: instant })
      .nullable(),
  }),
);

export const BootstrapSchema = res(
  "Bootstrap",
  z.object({
    viewer: ViewerSchema,
    projects: z.array(ProjectSchema),
    members: z.array(MemberSchema),
    /** Removed members (only to show historical names, e.g. task creators). */
    formerMembers: z.array(MemberSchema),
    limits: LimitsSchema,
  }),
);

export function currentLimits(): z.infer<typeof LimitsSchema> {
  return {
    maxMessageLength: CHAT_LIMITS.maxMessageLength,
    messagePageSize: CHAT_LIMITS.pageSize,
    maxFileBytes: CHAT_LIMITS.maxFileBytes,
    maxFilesPerMessage: CHAT_LIMITS.maxFilesPerMessage,
    allowedFileTypes: ALLOWED_FILE_TYPES.map((t) => ({ label: t.label, extensions: [...t.extensions], mimeType: t.mime })),
    invitationTtlDays: INVITATION_TTL_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Endpoint catalogue
// ---------------------------------------------------------------------------

const AUTH_ERRORS = ["UNAUTHENTICATED"] as const;
const MEMBER_ERRORS = ["UNAUTHENTICATED", "FORBIDDEN"] as const;

function endpoint<const D extends EndpointDef>(def: D): D {
  return def;
}

export const endpoints = {
  // ---- Meta / session ------------------------------------------------------
  getMeta: endpoint({
    method: "GET",
    path: "/meta",
    tag: "Meta",
    summary: "Environment and compatibility information (no auth).",
    auth: "public",
    response: MetaSchema,
    errors: [],
    retry: "safe",
  }),
  requestLoginCode: endpoint({
    method: "POST",
    path: "/auth/login-code",
    tag: "Session",
    summary: "Send a one-time code and magic link to an e-mail address.",
    description:
      "Same rule as the web login: no public sign-up; invited-but-unconfirmed addresses get their invitation again. " +
      "The response is identical for known and unknown addresses. Verify the code with Supabase Auth (verifyOTP).",
    auth: "public",
    body: req("LoginCodeRequest", z.object({ email: v.emailSchema })),
    response: res("LoginCodeResponse", z.object({ email: z.string() })),
    status: 202,
    errors: ["VALIDATION", "RATE_LIMITED"],
    retry: "safe",
  }),
  getMe: endpoint({
    method: "GET",
    path: "/me",
    tag: "Session",
    summary: "The signed-in user and their access state (works without membership).",
    auth: "session",
    response: MeSchema,
    errors: AUTH_ERRORS,
    retry: "safe",
  }),
  acceptInvitation: endpoint({
    method: "POST",
    path: "/invitations/accept",
    tag: "Session",
    summary: "Accept the invitation addressed to the signed-in e-mail.",
    auth: "session",
    body: req("AcceptInvitationRequest", z.object({ invitationId: v.uuid, fullName: v.profileNameSchema.shape.fullName })),
    response: MeSchema,
    errors: [...AUTH_ERRORS, "FORBIDDEN", "VALIDATION"],
    retry: "safe",
  }),
  getBootstrap: endpoint({
    method: "GET",
    path: "/bootstrap",
    tag: "Session",
    summary: "Everything the app shell needs after sign-in: viewer, projects, people, limits.",
    auth: "member",
    response: BootstrapSchema,
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  updateProfile: endpoint({
    method: "PATCH",
    path: "/me/profile",
    tag: "Session",
    summary: "Change the own display name.",
    auth: "member",
    body: req("UpdateProfileRequest", v.profileNameSchema),
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),

  // ---- Push notifications ---------------------------------------------------
  registerDevice: endpoint({
    method: "PUT",
    path: "/devices/{token}",
    tag: "Session",
    summary: "Register this device's APNs token for push notifications (moves it after an account switch).",
    auth: "member",
    params: z.object({ token: v.deviceTokenSchema }),
    body: req("RegisterDeviceRequest", v.registerDeviceSchema.omit({ token: true })),
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  unregisterDevice: endpoint({
    method: "DELETE",
    path: "/devices/{token}",
    tag: "Session",
    summary: "Stop pushes to this device (sign-out). Works without membership.",
    auth: "session",
    params: z.object({ token: v.deviceTokenSchema }),
    response: null,
    errors: [...AUTH_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  getNotificationSettings: endpoint({
    method: "GET",
    path: "/me/notification-settings",
    tag: "Session",
    summary: "Which events send a push to me.",
    auth: "member",
    response: NotificationSettingsSchema,
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  updateNotificationSettings: endpoint({
    method: "PATCH",
    path: "/me/notification-settings",
    tag: "Session",
    summary: "Change notification settings (omitted fields stay unchanged).",
    auth: "member",
    body: req("UpdateNotificationSettingsRequest", v.notificationSettingsPatchSchema),
    response: NotificationSettingsSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  listNotifications: endpoint({
    method: "GET",
    path: "/me/notifications",
    tag: "Session",
    summary: "My latest in-app notifications (chat mentions) and the unread count.",
    description:
      "Newest first, at most 50. Only conversations I can still access. Opening a notification means: open conversation `conversationId` and scroll to `messageId`.",
    auth: "member",
    response: NotificationPageSchema,
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  markNotificationsRead: endpoint({
    method: "POST",
    path: "/me/notifications/read",
    tag: "Session",
    summary: "Mark my notifications as read (the given ids, or all when `ids` is omitted).",
    description: "Reading a conversation (markRead) also marks the mentions up to that position as read.",
    auth: "member",
    body: req("MarkNotificationsReadRequest", v.markNotificationsReadSchema),
    response: res("NotificationUnreadCount", z.object({ unreadCount: z.number().int() })),
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),

  // ---- Tasks -----------------------------------------------------------------
  listTasks: endpoint({
    method: "GET",
    path: "/tasks",
    tag: "Tasks",
    summary: "Tasks of all active projects, or of one project (archived allowed, read-only), or of one milestone.",
    description: "Not paginated: bounded by the workspace. Ordered by board position.",
    auth: "member",
    query: z.object({ projectId: v.uuid.optional(), milestoneId: v.uuid.optional() }),
    response: res("TaskList", z.object({ tasks: z.array(TaskSchema) })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  createTask: endpoint({
    method: "POST",
    path: "/tasks",
    tag: "Tasks",
    summary: "Create a task (appended to the end of its status column).",
    description: "Send a client-generated `id` to make retries idempotent.",
    auth: "member",
    body: req("CreateTaskRequest", v.createTaskSchema),
    response: TaskSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  searchIssues: endpoint({
    method: "GET",
    path: "/issue-refs",
    tag: "Tasks",
    summary: "Tasks for the `#` picker in chat, matched by issue number and title.",
    description:
      "`q` is the text typed after `#`: digits match the number (exact first, then prefix), words match the title. " +
      "At most 8 results, best first; tasks of archived projects are omitted. Insert the chosen task as `<#task-id>` into the message markup.",
    auth: "member",
    query: z.object({ q: z.string().max(100).optional() }),
    response: res("IssueRefList", z.object({ issues: z.array(IssueRefSchema) })),
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  getTask: endpoint({
    method: "GET",
    path: "/tasks/{id}",
    tag: "Tasks",
    summary: "One task (e.g. deep link to a task of an archived project).",
    auth: "member",
    params: idParam,
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  updateTask: endpoint({
    method: "PATCH",
    path: "/tasks/{id}",
    tag: "Tasks",
    summary: "Edit a task with optimistic concurrency.",
    description:
      "Applies only if the stored version equals `expectedVersion`. Otherwise CONFLICT with `error.current`. " +
      "After a network failure, a CONFLICT whose `current` already contains the intended values means the first attempt succeeded.",
    auth: "member",
    params: idParam,
    body: req("UpdateTaskRequest", v.updateTaskSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED", "CONFLICT"],
    retry: "check-conflict",
  }),
  deleteTask: endpoint({
    method: "DELETE",
    path: "/tasks/{id}",
    tag: "Tasks",
    summary: "Delete a task permanently.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND", "ARCHIVED"],
    retry: "not-found-means-done",
  }),
  moveTask: endpoint({
    method: "POST",
    path: "/tasks/{id}/move",
    tag: "Tasks",
    summary: "Board: move a task to a status, between two visible neighbours.",
    description: "`afterId` ends up directly above, `beforeId` directly below (null = top/bottom). Hidden tasks keep their positions.",
    auth: "member",
    params: idParam,
    body: req("MoveTaskRequest", v.moveTaskSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setTaskStatus: endpoint({
    method: "PUT",
    path: "/tasks/{id}/status",
    tag: "Tasks",
    summary: "Quick action: set the status (task goes to the end of the column; no-op if unchanged).",
    auth: "member",
    params: idParam,
    body: req("SetTaskStatusRequest", v.setStatusSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setTaskAssignee: endpoint({
    method: "PUT",
    path: "/tasks/{id}/assignee",
    tag: "Tasks",
    summary: "Legacy quick action: one responsible person replaces all assignees (null = none). Use setTaskAssignees.",
    auth: "member",
    params: idParam,
    body: req("SetTaskAssigneeRequest", v.setAssigneeSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setTaskAssignees: endpoint({
    method: "PUT",
    path: "/tasks/{id}/assignees",
    tag: "Tasks",
    summary: "Quick action: set everyone responsible (empty list = unassigned).",
    description: "Order is kept (display order), duplicates are dropped. Newly added people get an assignment notification.",
    auth: "member",
    params: idParam,
    body: req("SetTaskAssigneesRequest", v.setAssigneesSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setTaskChecklistItem: endpoint({
    method: "PUT",
    path: "/tasks/{id}/checklist",
    tag: "Tasks",
    summary:
      "Quick action: tick or untick the n-th Markdown checklist item (`- [ ]`) in the description. Applied to the current description; `text` (the item's first line) identifies the item if lines moved. CONFLICT with `current` if the item is gone or ambiguous. Does not change the status.",
    auth: "member",
    params: idParam,
    body: req("SetTaskChecklistItemRequest", v.setChecklistItemSchema.omit({ id: true })),
    response: TaskSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED", "CONFLICT"],
    retry: "safe",
  }),

  listTaskLinks: endpoint({
    method: "GET",
    path: "/tasks/{id}/links",
    tag: "Tasks",
    summary: "External links attached to a task (oldest first). Also for tasks of archived projects.",
    auth: "member",
    params: idParam,
    response: res("TaskLinkList", z.object({ links: z.array(TaskLinkSchema) })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  createTaskLink: endpoint({
    method: "POST",
    path: "/tasks/{id}/links",
    tag: "Tasks",
    summary: "Attach an external http(s) link to a task, with an optional display name.",
    description:
      "The URL is validated and stored in canonical form (scheme-less input gets https://). " +
      "Send a client-generated `id` to make retries idempotent.",
    auth: "member",
    params: idParam,
    body: req("CreateTaskLinkRequest", v.createTaskLinkSchema.omit({ taskId: true })),
    response: TaskLinkSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateTaskLink: endpoint({
    method: "PATCH",
    path: "/task-links/{id}",
    tag: "Tasks",
    summary: "Change URL and display name of a task link (last write wins).",
    auth: "member",
    params: idParam,
    body: req("UpdateTaskLinkRequest", v.updateTaskLinkSchema.omit({ id: true })),
    response: TaskLinkSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  deleteTaskLink: endpoint({
    method: "DELETE",
    path: "/task-links/{id}",
    tag: "Tasks",
    summary: "Remove a link from its task.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND", "ARCHIVED"],
    retry: "not-found-means-done",
  }),

  // ---- Projects ---------------------------------------------------------------------
  listProjects: endpoint({
    method: "GET",
    path: "/projects",
    tag: "Projects",
    summary: "All projects (incl. archived, flagged) with task statistics.",
    auth: "member",
    response: res(
      "ProjectList",
      z.object({ projects: z.array(ProjectSchema), stats: z.record(z.string(), ProjectStatSchema) }),
    ),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createProject: endpoint({
    method: "POST",
    path: "/projects",
    tag: "Projects",
    summary: "Create a project.",
    auth: "member",
    body: req("CreateProjectRequest", v.createProjectSchema),
    response: ProjectSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  getProject: endpoint({
    method: "GET",
    path: "/projects/{id}",
    tag: "Projects",
    summary: "One project.",
    auth: "member",
    params: idParam,
    response: ProjectSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  updateProject: endpoint({
    method: "PATCH",
    path: "/projects/{id}",
    tag: "Projects",
    summary: "Edit name, description and colour (not for archived projects).",
    auth: "member",
    params: idParam,
    body: req("UpdateProjectRequest", v.updateProjectSchema.omit({ id: true })),
    response: ProjectSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setProjectArchived: endpoint({
    method: "PUT",
    path: "/projects/{id}/archived",
    tag: "Projects",
    summary: "Archive or restore a project.",
    auth: "member",
    params: idParam,
    body: SetArchivedRequest,
    response: ProjectSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  // ---- Milestones ---------------------------------------------------------------
  listMilestones: endpoint({
    method: "GET",
    path: "/milestones",
    tag: "Milestones",
    summary: "All milestones (open first, by due date; then completed) with task counts.",
    auth: "member",
    response: res("MilestoneList", z.object({ milestones: z.array(MilestoneSchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createMilestone: endpoint({
    method: "POST",
    path: "/milestones",
    tag: "Milestones",
    summary: "Create a milestone.",
    auth: "member",
    body: req("CreateMilestoneRequest", v.createMilestoneSchema),
    response: MilestoneSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  getMilestone: endpoint({
    method: "GET",
    path: "/milestones/{id}",
    tag: "Milestones",
    summary: "One milestone with task counts.",
    auth: "member",
    params: idParam,
    response: MilestoneSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  updateMilestone: endpoint({
    method: "PATCH",
    path: "/milestones/{id}",
    tag: "Milestones",
    summary: "Edit name, description and due date.",
    auth: "member",
    params: idParam,
    body: req("UpdateMilestoneRequest", v.updateMilestoneSchema.omit({ id: true })),
    response: MilestoneSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  setMilestoneCompleted: endpoint({
    method: "PUT",
    path: "/milestones/{id}/completed",
    tag: "Milestones",
    summary: "Complete or reopen a milestone (its tasks stay attached).",
    auth: "member",
    params: idParam,
    body: req("SetCompletedRequest", z.object({ completed: z.boolean() })),
    response: MilestoneSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  deleteMilestone: endpoint({
    method: "DELETE",
    path: "/milestones/{id}",
    tag: "Milestones",
    summary: "Delete a milestone; its tasks are kept without milestone.",
    auth: "member",
    params: idParam,
    response: res("DeleteMilestoneResponse", z.object({ id: v.uuid, detachedTasks: z.number().int() })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),

  // ---- Personal to-dos ----------------------------------------------------------
  listTodos: endpoint({
    method: "GET",
    path: "/todos",
    tag: "Todos",
    summary: "The caller's own to-dos: open ones by position, then completed ones (latest first).",
    auth: "member",
    response: res("TodoList", z.object({ todos: z.array(TodoSchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createTodo: endpoint({
    method: "POST",
    path: "/todos",
    tag: "Todos",
    summary: "Add a to-do at the top of the open list.",
    auth: "member",
    body: req("CreateTodoRequest", createTodoSchema),
    response: TodoSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateTodo: endpoint({
    method: "PATCH",
    path: "/todos/{id}",
    tag: "Todos",
    summary: "Edit, complete or reopen an own to-do (only sent fields change).",
    auth: "member",
    params: idParam,
    body: req("UpdateTodoRequest", updateTodoSchema.shape.patch),
    response: TodoSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteTodo: endpoint({
    method: "DELETE",
    path: "/todos/{id}",
    tag: "Todos",
    summary: "Delete an own to-do.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  reorderTodos: endpoint({
    method: "PUT",
    path: "/todos/order",
    tag: "Todos",
    summary: "New order of the open to-dos (top to bottom).",
    auth: "member",
    body: req("ReorderTodosRequest", reorderTodosSchema),
    response: res("ReorderedTodos", z.object({ todos: z.array(TodoSchema) })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),

  // ---- Ideas --------------------------------------------------------------------
  listIdeas: endpoint({
    method: "GET",
    path: "/ideas",
    tag: "Ideas",
    summary: "The shared idea backlog, newest first.",
    auth: "member",
    response: res("IdeaList", z.object({ ideas: z.array(IdeaSchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createIdea: endpoint({
    method: "POST",
    path: "/ideas",
    tag: "Ideas",
    summary: "Add an idea.",
    auth: "member",
    body: req("CreateIdeaRequest", createIdeaSchema),
    response: IdeaSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateIdea: endpoint({
    method: "PATCH",
    path: "/ideas/{id}",
    tag: "Ideas",
    summary: "Edit an idea (only sent fields change).",
    auth: "member",
    params: idParam,
    body: req("UpdateIdeaRequest", updateIdeaSchema.shape.patch),
    response: IdeaSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteIdea: endpoint({
    method: "DELETE",
    path: "/ideas/{id}",
    tag: "Ideas",
    summary: "Delete an idea (an issue created from it stays).",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  createIssueFromIdea: endpoint({
    method: "POST",
    path: "/ideas/{id}/issue",
    tag: "Ideas",
    summary: "Create a task from the idea in a project and link it. Repeating returns the existing task.",
    auth: "member",
    params: idParam,
    body: req("CreateIssueFromIdeaRequest", z.object({ projectId: v.uuid })),
    response: res("IdeaIssue", z.object({ idea: IdeaSchema, task: TaskSchema })),
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),

  // ---- CRM ----------------------------------------------------------------------
  listAttractions: endpoint({
    method: "GET",
    path: "/attractions",
    tag: "CRM",
    summary: "All CRM entries by name.",
    auth: "member",
    response: res("AttractionList", z.object({ attractions: z.array(AttractionSchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createAttraction: endpoint({
    method: "POST",
    path: "/attractions",
    tag: "CRM",
    summary: "Add a CRM entry (writes the \"created\" timeline entry).",
    auth: "member",
    body: req("CreateAttractionRequest", createAttractionSchema),
    response: AttractionSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateAttraction: endpoint({
    method: "PATCH",
    path: "/attractions/{id}",
    tag: "CRM",
    summary: "Edit a CRM entry (only sent fields change; status/owner/follow-up changes are logged).",
    auth: "member",
    params: idParam,
    body: req("UpdateAttractionRequest", updateAttractionSchema.shape.patch),
    response: AttractionSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteAttraction: endpoint({
    method: "DELETE",
    path: "/attractions/{id}",
    tag: "CRM",
    summary: "Delete a CRM entry with its timeline.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  listActivities: endpoint({
    method: "GET",
    path: "/attractions/{id}/activities",
    tag: "CRM",
    summary: "Timeline of a CRM entry, newest first.",
    auth: "member",
    params: idParam,
    response: res("ActivityList", z.object({ activities: z.array(ActivitySchema) })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  addActivity: endpoint({
    method: "POST",
    path: "/attractions/{id}/activities",
    tag: "CRM",
    summary: "Log a call, e-mail, meeting or note (optionally with the next follow-up).",
    auth: "member",
    params: idParam,
    body: req("CreateActivityRequest", createActivitySchema.omit({ attractionId: true })),
    response: ActivityChange,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateActivity: endpoint({
    method: "PATCH",
    path: "/activities/{id}",
    tag: "CRM",
    summary: "Edit a manual timeline entry (author or admin).",
    auth: "member",
    params: idParam,
    body: req("UpdateActivityRequest", updateActivitySchema.shape.patch),
    response: ActivityChange,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteActivity: endpoint({
    method: "DELETE",
    path: "/activities/{id}",
    tag: "CRM",
    summary: "Delete a manual timeline entry (author or admin).",
    auth: "member",
    params: idParam,
    response: res("ActivityDeleted", z.object({ attraction: AttractionSchema })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),

  // ---- Decisions ----------------------------------------------------------------
  listDecisions: endpoint({
    method: "GET",
    path: "/decisions",
    tag: "Decisions",
    summary: "Decisions and experiments: full-text search, filters, sorting.",
    auth: "member",
    query: z.object({
      query: z.string().max(DECISION_LIMITS.queryMax).optional(),
      type: DecisionTypeSchema.optional(),
      status: DecisionStatusSchema.optional(),
      assigneeId: z
        .string()
        .refine((s) => s === "none" || v.uuid.safeParse(s).success, { error: "Ungültige Person." })
        .optional()
        .describe("Member id, or \"none\" for entries without a responsible member."),
      sort: DecisionSortSchema.optional(),
    }),
    response: res("DecisionList", z.object({ decisions: z.array(DecisionSummarySchema) })),
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  createDecision: endpoint({
    method: "POST",
    path: "/decisions",
    tag: "Decisions",
    summary: "Record a decision or experiment (only the title is required).",
    auth: "member",
    body: req("CreateDecisionRequest", createDecisionSchema),
    response: DecisionSummarySchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  getDecision: endpoint({
    method: "GET",
    path: "/decisions/{id}",
    tag: "Decisions",
    summary: "One entry with links, linked issues/ideas and history.",
    auth: "member",
    params: idParam,
    response: DecisionDetailSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  updateDecision: endpoint({
    method: "PATCH",
    path: "/decisions/{id}",
    tag: "Decisions",
    summary: "Edit an entry (only sent fields change).",
    description:
      "The status must belong to the type; concluding requires the result fields (VALIDATION with fieldErrors otherwise) " +
      "and sets the day automatically. \"superseded\" is only reachable via supersedeDecision.",
    auth: "member",
    params: idParam,
    body: req("UpdateDecisionRequest", decisionPatchSchema),
    response: DecisionDetailSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteDecision: endpoint({
    method: "DELETE",
    path: "/decisions/{id}",
    tag: "Decisions",
    summary: "Delete an entry; decisions it replaced become valid again.",
    auth: "member",
    params: idParam,
    response: res("DeleteDecisionResponse", z.object({ id: v.uuid, restored: z.array(v.uuid) })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  listSupersedeCandidates: endpoint({
    method: "GET",
    path: "/decisions/{id}/supersede-candidates",
    tag: "Decisions",
    summary: "Decisions that may replace this one.",
    auth: "member",
    params: idParam,
    response: res("DecisionRefList", z.object({ decisions: z.array(DecisionRefSchema) })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  supersedeDecision: endpoint({
    method: "POST",
    path: "/decisions/{id}/supersede",
    tag: "Decisions",
    summary: "Replace a decided decision by an existing one (successorId) or a new one (newTitle + newId).",
    auth: "member",
    params: idParam,
    body: req("SupersedeDecisionRequest", supersedeRequestSchema),
    response: res("SupersedeResult", z.object({ decision: DecisionDetailSchema, successor: DecisionSummarySchema })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "CONFLICT"],
    retry: "safe",
  }),
  createDecisionLink: endpoint({
    method: "POST",
    path: "/decisions/{id}/links",
    tag: "Decisions",
    summary: "Attach a web link.",
    auth: "member",
    params: idParam,
    body: req("CreateDecisionLinkRequest", createDecisionLinkSchema.omit({ decisionId: true })),
    response: DecisionLinkSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  updateDecisionLink: endpoint({
    method: "PUT",
    path: "/decision-links/{id}",
    tag: "Decisions",
    summary: "Change URL and name of a link.",
    auth: "member",
    params: idParam,
    body: req("UpdateDecisionLinkRequest", updateDecisionLinkSchema.omit({ id: true })),
    response: DecisionLinkSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  deleteDecisionLink: endpoint({
    method: "DELETE",
    path: "/decision-links/{id}",
    tag: "Decisions",
    summary: "Remove a link.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  listRelationCandidates: endpoint({
    method: "GET",
    path: "/decisions/{id}/relation-candidates",
    tag: "Decisions",
    summary: "Issues and ideas that can be linked (search by title or #number).",
    auth: "member",
    params: idParam,
    query: z.object({ query: z.string().max(DECISION_LIMITS.queryMax).optional() }),
    response: res("RelationCandidateList", z.object({ candidates: z.array(RelationCandidateSchema) })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  addDecisionRelation: endpoint({
    method: "POST",
    path: "/decisions/{id}/relations",
    tag: "Decisions",
    summary: "Link an issue or idea (linking twice is a no-op).",
    auth: "member",
    params: idParam,
    body: req("AddDecisionRelationRequest", addDecisionRelationSchema.omit({ decisionId: true })),
    response: res("DecisionRelationList", z.object({ relations: z.array(DecisionRelationSchema) })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  removeDecisionRelation: endpoint({
    method: "DELETE",
    path: "/decision-relations/{id}",
    tag: "Decisions",
    summary: "Unlink an issue or idea.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),

  // ---- Team -------------------------------------------------------------------
  getTeam: endpoint({
    method: "GET",
    path: "/team",
    tag: "Team",
    summary: "Active members and pending invitations (same visibility as the web; managing them is admin-only).",
    auth: "member",
    response: res("Team", z.object({ members: z.array(MemberSchema), invitations: z.array(InvitationSchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  updateMeetingUrl: endpoint({
    method: "PUT",
    path: "/workspace/meeting-url",
    tag: "Team",
    summary: "Admin: set or clear the workspace meeting link (e.g. a Discord voice channel).",
    auth: "admin",
    body: req("UpdateMeetingUrlRequest", v.meetingUrlSchema),
    response: res("MeetingUrl", z.object({ meetingUrl: z.string().nullable() })),
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  inviteMember: endpoint({
    method: "POST",
    path: "/invitations",
    tag: "Team",
    summary: "Admin: invite an e-mail address (sends the invitation e-mail).",
    auth: "admin",
    body: req("InviteRequest", v.inviteSchema),
    response: InvitationSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "check-conflict",
  }),
  resendInvitation: endpoint({
    method: "POST",
    path: "/invitations/{id}/resend",
    tag: "Team",
    summary: "Admin: send the invitation again (renews the 7-day validity).",
    auth: "admin",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  revokeInvitation: endpoint({
    method: "DELETE",
    path: "/invitations/{id}",
    tag: "Team",
    summary: "Admin: revoke a pending invitation.",
    auth: "admin",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  changeMemberRole: endpoint({
    method: "PUT",
    path: "/members/{userId}/role",
    tag: "Team",
    summary: "Admin: change a member's role (the last admin cannot be demoted).",
    auth: "admin",
    params: z.object({ userId: v.uuid }),
    body: req("ChangeRoleRequest", z.object({ role: MemberRoleSchema })),
    response: null,
    errors: [...MEMBER_ERRORS, "NOT_FOUND", "LAST_ADMIN"],
    retry: "safe",
  }),
  removeMember: endpoint({
    method: "DELETE",
    path: "/members/{userId}",
    tag: "Team",
    summary: "Admin: remove a member (access ends immediately; tasks stay, assignments are cleared).",
    auth: "admin",
    params: z.object({ userId: v.uuid }),
    response: res("RemoveMemberResponse", z.object({ unassignedTasks: z.number().int() })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND", "LAST_ADMIN"],
    retry: "not-found-means-done",
  }),

  // ---- Chat ---------------------------------------------------------------------
  listConversations: endpoint({
    method: "GET",
    path: "/conversations",
    tag: "Chat",
    summary: "Conversations visible to the caller (open channels, own private channels and DMs) with unread state.",
    auth: "member",
    response: res("ConversationList", z.object({ conversations: z.array(ConversationSummarySchema) })),
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
  createChannel: endpoint({
    method: "POST",
    path: "/conversations/channels",
    tag: "Chat",
    summary: "Create an open or private channel.",
    auth: "member",
    body: req("CreateChannelRequest", v.createChannelSchema),
    response: ConversationRef,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "CONFLICT"],
    retry: "idempotent-with-client-id",
  }),
  openDirectMessage: endpoint({
    method: "POST",
    path: "/conversations/direct",
    tag: "Chat",
    summary: "Open (or create exactly once) the DM with another member.",
    auth: "member",
    body: req("OpenDirectMessageRequest", v.openDmSchema),
    response: ConversationRef,
    errors: [...MEMBER_ERRORS, "VALIDATION"],
    retry: "safe",
  }),
  getConversation: endpoint({
    method: "GET",
    path: "/conversations/{id}",
    tag: "Chat",
    summary: "Conversation details incl. participants and permissions.",
    auth: "member",
    params: idParam,
    response: ConversationDetailSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  updateChannel: endpoint({
    method: "PATCH",
    path: "/conversations/{id}",
    tag: "Chat",
    summary: "Rename a channel / change its description (responsible person or admins).",
    auth: "member",
    params: idParam,
    body: req("UpdateChannelRequest", v.updateChannelSchema.omit({ id: true })),
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  setChannelArchived: endpoint({
    method: "PUT",
    path: "/conversations/{id}/archived",
    tag: "Chat",
    summary: "Archive or restore a channel (\"Allgemein\" cannot be archived).",
    auth: "member",
    params: idParam,
    body: SetArchivedRequest,
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  addChannelMembers: endpoint({
    method: "POST",
    path: "/conversations/{id}/members",
    tag: "Chat",
    summary: "Private channels: add members (they see the full history).",
    auth: "member",
    params: idParam,
    body: req("AddChannelMembersRequest", v.channelMembersSchema.omit({ id: true })),
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  removeChannelMember: endpoint({
    method: "POST",
    path: "/conversations/{id}/members/remove",
    tag: "Chat",
    summary: "Private channels: remove a member or leave (responsible person must hand over or archive).",
    auth: "member",
    params: idParam,
    body: req("RemoveChannelMemberRequest", v.removeChannelMemberSchema.omit({ id: true })),
    response: res("RemoveChannelMemberResponse", z.object({ archived: z.boolean() })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "safe",
  }),
  listMessages: endpoint({
    method: "GET",
    path: "/conversations/{id}/messages",
    tag: "Chat",
    summary: "Messages, ascending by seq. Cursor pagination.",
    description:
      "No cursor: newest page. `beforeSeq`: older page (scrolling up). `afterSeq`: everything newer " +
      "(resync after reconnect; bounded, `hasMore` = call again with the last seq).",
    auth: "member",
    params: idParam,
    query: z.object({
      beforeSeq: z.coerce.number().int().positive().optional(),
      afterSeq: z.coerce.number().int().nonnegative().optional(),
    }),
    response: res(
      "MessagePage",
      z.object({ messages: z.array(MessageSchema), hasMore: z.boolean(), authors: z.array(ChatPersonSchema) }),
    ),
    errors: [...MEMBER_ERRORS, "NOT_FOUND", "VALIDATION"],
    retry: "safe",
  }),
  sendMessage: endpoint({
    method: "PUT",
    path: "/conversations/{id}/messages/{messageId}",
    tag: "Chat",
    summary: "Send a message with a client-generated id (idempotent).",
    description: "Repeating the request with the same id returns the stored message instead of a duplicate.",
    auth: "member",
    params: z.object({ id: v.uuid, messageId: v.uuid }),
    body: req("SendMessageRequest", v.sendMessageSchema.omit({ id: true, conversationId: true })),
    response: MessageSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED", "CONFLICT"],
    retry: "safe",
  }),
  getMessage: endpoint({
    method: "GET",
    path: "/messages/{id}",
    tag: "Chat",
    summary: "One message with attachments and author (used after realtime events).",
    auth: "member",
    params: idParam,
    response: res("MessageWithAuthor", z.object({ message: MessageSchema, author: ChatPersonSchema.nullable() })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  editMessage: endpoint({
    method: "PATCH",
    path: "/messages/{id}",
    tag: "Chat",
    summary: "Edit an own message.",
    auth: "member",
    params: idParam,
    body: req("EditMessageRequest", v.editMessageSchema.omit({ id: true })),
    response: MessageSchema,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  deleteMessage: endpoint({
    method: "DELETE",
    path: "/messages/{id}",
    tag: "Chat",
    summary: "Delete an own message (placeholder remains, attachments are removed).",
    auth: "member",
    params: idParam,
    response: MessageSchema,
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  markRead: endpoint({
    method: "PUT",
    path: "/conversations/{id}/read",
    tag: "Chat",
    summary: "Move the own read position forward (never backwards, never beyond the latest message).",
    auth: "member",
    params: idParam,
    body: req("MarkReadRequest", v.markReadSchema.omit({ conversationId: true })),
    response: res("ReadState", z.object({ lastReadSeq: z.number().int() })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),

  // ---- Files --------------------------------------------------------------------
  reserveUpload: endpoint({
    method: "POST",
    path: "/conversations/{id}/uploads",
    tag: "Files",
    summary: "Reserve an attachment upload (type, size and workspace budget are checked).",
    description:
      "Then PUT the bytes to `signedUrl` (headers: content-type, x-upsert: false) and call finalizeUpload. " +
      "Reservations expire after 15 minutes; unsent uploads after 24 hours.",
    auth: "member",
    params: idParam,
    body: req("ReserveUploadRequest", v.reserveUploadSchema.omit({ conversationId: true })),
    response: UploadTicketSchema,
    status: 201,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "check-conflict",
  }),
  finalizeUpload: endpoint({
    method: "POST",
    path: "/uploads/{id}/finalize",
    tag: "Files",
    summary: "Verify the uploaded bytes (size, file signature) and make the file attachable.",
    auth: "member",
    params: idParam,
    response: res("FinalizedUpload", z.object({ id: v.uuid, sizeBytes: z.number().int() })),
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND", "ARCHIVED"],
    retry: "safe",
  }),
  discardUpload: endpoint({
    method: "DELETE",
    path: "/uploads/{id}",
    tag: "Files",
    summary: "Remove a not-yet-sent upload.",
    auth: "member",
    params: idParam,
    response: null,
    errors: [...MEMBER_ERRORS, "VALIDATION", "NOT_FOUND"],
    retry: "not-found-means-done",
  }),
  getDownloadUrl: endpoint({
    method: "GET",
    path: "/attachments/{id}/download",
    tag: "Files",
    summary: "Short-lived (60 s) download URL after a fresh access check.",
    description: "Download only on explicit user action; do not prefetch.",
    auth: "member",
    params: idParam,
    response: res("DownloadUrl", z.object({ url: z.string(), expiresInSeconds: z.number().int() })),
    errors: [...MEMBER_ERRORS, "NOT_FOUND"],
    retry: "safe",
  }),
  getChatStorageUsage: endpoint({
    method: "GET",
    path: "/chat/storage",
    tag: "Files",
    summary: "Admin: chat file storage usage of the workspace.",
    auth: "admin",
    response: ChatStorageUsageSchema,
    errors: MEMBER_ERRORS,
    retry: "safe",
  }),
} as const;

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;

type OutputOf<S> = S extends z.ZodType ? z.output<S> : undefined;
export type EndpointInput<K extends OperationId> = {
  params: OutputOf<Endpoints[K] extends { params: infer P } ? P : undefined>;
  query: OutputOf<Endpoints[K] extends { query: infer Q } ? Q : undefined>;
  body: OutputOf<Endpoints[K] extends { body: infer B } ? B : undefined>;
};
export type EndpointOutput<K extends OperationId> = Endpoints[K]["response"] extends z.ZodType
  ? z.input<Endpoints[K]["response"]>
  : void;

export const ALL_ERROR_CODES = ERROR_CODES;
