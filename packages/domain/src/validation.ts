import { z } from "zod";
import { CHAT_LIMITS } from "./chat-config";
import { isIsoDate } from "./dates";
import { isWebUrl, LINK_LIMITS, normalizeWebUrl } from "./links";
import { MEMBER_ROLES, PROJECT_COLOR_KEYS, TASK_STATUSES } from "./domain";

/** Input schemas shared by forms (inline validation) and Server Actions. */

export const uuid = z.uuid({ error: "Ungültige ID." });

const calendarDate = z
  .string()
  .refine(isIsoDate, { error: "Ungültiges Datum." })
  // Calendar day "YYYY-MM-DD" (API contract: format "date").
  .meta({ format: "date" })
  .nullable();

const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} darf höchstens ${max} Zeichen lang sein.` });

export const taskTitle = trimmed(300, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
export const taskDescription = z.string().max(20000, { error: "Die Beschreibung ist zu lang." });

function dateRangeRefinement<T extends { startDate?: string | null; endDate?: string | null }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Das Enddatum darf nicht vor dem Startdatum liegen.",
    });
  }
}

/**
 * Optional client-generated id for creates: makes retries idempotent (a
 * repeated request returns the already stored record instead of a duplicate).
 */
const clientId = uuid.optional();

export const createTaskSchema = z
  .object({
    id: clientId,
    projectId: uuid,
    title: taskTitle,
    description: taskDescription.default(""),
    status: z.enum(TASK_STATUSES).default("open"),
    groupId: uuid.nullable().default(null),
    assigneeId: uuid.nullable().default(null),
    startDate: calendarDate.default(null),
    endDate: calendarDate.default(null),
  })
  .superRefine(dateRangeRefinement);
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const taskPatchSchema = z
  .object({
    projectId: uuid,
    title: taskTitle,
    description: taskDescription,
    status: z.enum(TASK_STATUSES),
    groupId: uuid.nullable(),
    assigneeId: uuid.nullable(),
    startDate: calendarDate,
    endDate: calendarDate,
  })
  .partial()
  .superRefine(dateRangeRefinement);

export const updateTaskSchema = z.object({
  id: uuid,
  expectedVersion: z.number().int().positive(),
  patch: taskPatchSchema,
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  id: uuid,
  status: z.enum(TASK_STATUSES),
  /** Task that should end up directly above (null = top of column). */
  afterId: uuid.nullable(),
  /** Task that should end up directly below (null = bottom of column). */
  beforeId: uuid.nullable(),
});
export type MoveTaskInput = z.input<typeof moveTaskSchema>;

export const setStatusSchema = z.object({ id: uuid, status: z.enum(TASK_STATUSES) });
export const setAssigneeSchema = z.object({ id: uuid, assigneeId: uuid.nullable() });
export const idSchema = z.object({ id: uuid });

export const projectSchema = z.object({
  name: trimmed(120, "Der Name").min(1, { error: "Bitte gib einen Namen ein." }),
  description: trimmed(500, "Die Beschreibung").default(""),
  color: z.enum(PROJECT_COLOR_KEYS as [string, ...string[]]).default("slate"),
});
export const createProjectSchema = projectSchema.extend({ id: clientId });
export const updateProjectSchema = projectSchema.extend({ id: uuid });
export const archiveProjectSchema = z.object({ id: uuid, archived: z.boolean() });

export const groupNameSchema = trimmed(80, "Der Name").min(1, { error: "Bitte gib einen Namen ein." });
export const createGroupSchema = z.object({ id: clientId, projectId: uuid, name: groupNameSchema });
export const renameGroupSchema = z.object({ id: uuid, name: groupNameSchema });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }));

// ---------------------------------------------------------------------------
// External links (task attachments, meeting link)
// ---------------------------------------------------------------------------

/** http(s) URL; scheme-less input gets `https://`. Stored in canonical form. */
export const webUrlSchema = z
  .string()
  .overwrite(normalizeWebUrl)
  .min(1, { error: "Bitte gib einen Link ein." })
  .max(LINK_LIMITS.urlMax, { error: "Der Link ist zu lang." })
  .refine(isWebUrl, { error: "Bitte gib einen gültigen Web-Link ein (https://…)." })
  .meta({ format: "uri" });

/** Optional display name; empty input means "no title". */
const linkTitle = trimmed(LINK_LIMITS.titleMax, "Der Name").nullable().default(null);

export const createTaskLinkSchema = z.object({
  id: clientId,
  taskId: uuid,
  url: webUrlSchema,
  title: linkTitle,
});
export type CreateTaskLinkInput = z.input<typeof createTaskLinkSchema>;

export const updateTaskLinkSchema = z.object({ id: uuid, url: webUrlSchema, title: linkTitle });
export type UpdateTaskLinkInput = z.input<typeof updateTaskLinkSchema>;

export const taskIdSchema = z.object({ taskId: uuid });

/** Workspace meeting link (e.g. a Discord voice channel); null removes it. */
export const meetingUrlSchema = z.object({ meetingUrl: webUrlSchema.nullable() });

export const inviteSchema = z.object({ email: emailSchema, role: z.enum(MEMBER_ROLES).default("member") });
export const changeRoleSchema = z.object({ userId: uuid, role: z.enum(MEMBER_ROLES) });
export const userIdSchema = z.object({ userId: uuid });
export const profileNameSchema = z.object({
  fullName: trimmed(80, "Der Name").min(1, { error: "Bitte gib deinen Namen ein." }),
});

/** Flatten zod issues into { field: message } (first message per field). */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((p) => typeof p === "string" || typeof p === "number").join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Bitte gib einen Namen ein." })
  .max(CHAT_LIMITS.channelNameMax, { error: `Der Name darf höchstens ${CHAT_LIMITS.channelNameMax} Zeichen lang sein.` });

const channelDescription = z
  .string()
  .trim()
  .max(CHAT_LIMITS.channelDescriptionMax, {
    error: `Die Beschreibung darf höchstens ${CHAT_LIMITS.channelDescriptionMax} Zeichen lang sein.`,
  });

export const createChannelSchema = z.object({
  id: clientId,
  name: channelNameSchema,
  description: channelDescription.default(""),
  visibility: z.enum(["open", "private"]),
  memberIds: z.array(uuid).max(200).default([]),
});
export const updateChannelSchema = z.object({ id: uuid, name: channelNameSchema, description: channelDescription });
export const archiveChannelSchema = z.object({ id: uuid, archived: z.boolean() });
export const channelMembersSchema = z.object({ id: uuid, userIds: z.array(uuid).min(1).max(200) });
export const removeChannelMemberSchema = z.object({
  id: uuid,
  userId: uuid,
  /** Required when the responsible member leaves and others remain (unless archiving). */
  newOwnerId: uuid.nullable().default(null),
  archive: z.boolean().default(false),
});
export const openDmSchema = z.object({ userId: uuid });

export const messageBodySchema = z
  .string()
  .max(CHAT_LIMITS.maxMessageLength, {
    error: `Eine Nachricht darf höchstens ${CHAT_LIMITS.maxMessageLength.toLocaleString("de-DE")} Zeichen lang sein.`,
  });
export const sendMessageSchema = z.object({
  id: uuid,
  conversationId: uuid,
  body: messageBodySchema,
  attachmentIds: z.array(uuid).max(CHAT_LIMITS.maxFilesPerMessage, {
    error: `Höchstens ${CHAT_LIMITS.maxFilesPerMessage} Dateien pro Nachricht.`,
  }).default([]),
});
export const editMessageSchema = z.object({ id: uuid, body: messageBodySchema });
export const listMessagesSchema = z.object({
  conversationId: uuid,
  beforeSeq: z.number().int().positive().nullable().default(null),
  afterSeq: z.number().int().nonnegative().nullable().default(null),
});
export const markReadSchema = z.object({ conversationId: uuid, seq: z.number().int().nonnegative() });
export const reserveUploadSchema = z.object({
  conversationId: uuid,
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/** APNs device token (hex). */
export const deviceTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{16,200}$/, { error: "Ungültiges Geräte-Token." });

export const registerDeviceSchema = z.object({
  token: deviceTokenSchema,
  /** sandbox = Xcode/debug builds, production = TestFlight/App Store. */
  environment: z.enum(["sandbox", "production"]),
});

export const notificationSettingsPatchSchema = z.object({
  directMessages: z.boolean().optional(),
  channelMessages: z.boolean().optional(),
  taskAssignments: z.boolean().optional(),
});
