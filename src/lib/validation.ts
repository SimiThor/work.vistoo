import { z } from "zod";
import { isIsoDate } from "./dates";
import { MEMBER_ROLES, PROJECT_COLOR_KEYS, TASK_STATUSES } from "./domain";

/** Input schemas shared by forms (inline validation) and Server Actions. */

export const uuid = z.uuid({ error: "Ungültige ID." });

const calendarDate = z
  .string()
  .refine(isIsoDate, { error: "Ungültiges Datum." })
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

export const createTaskSchema = z
  .object({
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
export const updateProjectSchema = projectSchema.extend({ id: uuid });
export const archiveProjectSchema = z.object({ id: uuid, archived: z.boolean() });

export const groupNameSchema = trimmed(80, "Der Name").min(1, { error: "Bitte gib einen Namen ein." });
export const createGroupSchema = z.object({ projectId: uuid, name: groupNameSchema });
export const renameGroupSchema = z.object({ id: uuid, name: groupNameSchema });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }));

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
