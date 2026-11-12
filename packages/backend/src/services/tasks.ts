import "server-only";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { TaskDTO, TaskStatus } from "@vistoo/domain";
import type { z } from "zod";
import type {
  createTaskSchema,
  moveTaskSchema,
  setAssigneeSchema,
  setAssigneesSchema,
  setChecklistItemSchema,
  setStatusSchema,
  updateTaskSchema,
} from "@vistoo/domain/validation";
import { setChecklistItem } from "@vistoo/domain/markdown";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import { projects, tasks, type Task } from "@vistoo/database/schema";
import { AppError, invalid, notFound } from "../errors";
import { assertActiveMembers, assertMilestoneInWorkspace, getWritableProject } from "./guards";
import { notifyAssignment } from "./notifications";

const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

export function toTaskDTO(t: Task): TaskDTO {
  return {
    id: t.id,
    projectId: t.projectId,
    groupId: null, // groups were removed; kept in API v1 for older app builds
    milestoneId: t.milestoneId,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    assigneeId: t.assigneeIds[0] ?? null,
    assigneeIds: t.assigneeIds,
    startDate: t.startDate,
    endDate: t.endDate,
    position: t.position,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    version: t.version,
  };
}

/** Unique ids, first occurrence wins (display order). */
function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The assignee list a write asks for: `assigneeIds` if sent, otherwise the
 * legacy single `assigneeId` (older app builds) replaces the list.
 * `undefined` = leave unchanged.
 */
function requestedAssignees(input: { assigneeIds?: string[]; assigneeId?: string | null }): string[] | undefined {
  if (input.assigneeIds !== undefined) return uniqueIds(input.assigneeIds);
  if (input.assigneeId !== undefined) return input.assigneeId ? [input.assigneeId] : [];
  return undefined;
}

/** Assignees that need to be checked/notified: in `next` but not in `previous`. */
function addedAssignees(previous: string[], next: string[]): string[] {
  return next.filter((u) => !previous.includes(u));
}

const columnOrder = [asc(tasks.position), asc(tasks.createdAt), asc(tasks.id)];

/**
 * Tasks of all non-archived projects, or of one project (archived allowed,
 * read-only), or of one milestone (non-archived projects only).
 */
export async function listTasks(
  ctx: AuthContext,
  opts: { projectId?: string; milestoneId?: string } = {},
): Promise<TaskDTO[]> {
  const db = getDb();
  const rows = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.workspaceId, tasks.workspaceId)))
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        opts.projectId ? eq(tasks.projectId, opts.projectId) : isNull(projects.archivedAt),
        opts.milestoneId ? eq(tasks.milestoneId, opts.milestoneId) : undefined,
      ),
    )
    .orderBy(...columnOrder);
  return rows.map((r) => toTaskDTO(r.task));
}

export async function getTask(ctx: AuthContext, id: string): Promise<TaskDTO> {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Aufgabe");
  return toTaskDTO(row);
}

async function lockTask(tx: Tx, ctx: AuthContext, id: string): Promise<Task> {
  const [row] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!row) throw notFound("Aufgabe");
  return row;
}

async function endOfColumn(db: DbOrTx, ctx: AuthContext, status: TaskStatus): Promise<number> {
  const [r] = await db
    .select({ max: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.status, status)));
  return (r?.max ?? 0) + POSITION_STEP;
}

/** Retried create with a client id: the stored record if it is the caller's, otherwise a conflict. */
async function existingOwnTask(db: DbOrTx, ctx: AuthContext, id: string | undefined): Promise<Task | null> {
  if (!id) return null;
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!row) return null;
  if (row.workspaceId !== ctx.workspaceId || row.createdBy !== ctx.userId) {
    throw new AppError("CONFLICT", "Diese Aufgabe konnte nicht angelegt werden.");
  }
  return row;
}

export async function createTask(ctx: AuthContext, input: z.output<typeof createTaskSchema>): Promise<TaskDTO> {
  let created = false;
  const task = await getDb().transaction(async (tx) => {
    const existing = await existingOwnTask(tx, ctx, input.id);
    if (existing) return toTaskDTO(existing);
    const row = await insertTask(tx, ctx, input);
    created = true;
    return toTaskDTO(row);
  });
  if (created) notifyAssignment(ctx, task);
  return task;
}

/**
 * The one way to insert a task (checks project, milestone, assignee; appends to
 * the status column). Runs inside the caller's transaction, e.g. when an
 * idea becomes an issue.
 */
export async function insertTask(tx: Tx, ctx: AuthContext, input: z.output<typeof createTaskSchema>): Promise<Task> {
  await getWritableProject(tx, ctx, input.projectId);
  if (input.milestoneId) await assertMilestoneInWorkspace(tx, ctx, input.milestoneId);
  const assigneeIds = requestedAssignees(input) ?? [];
  await assertActiveMembers(tx, ctx, assigneeIds);
  const position = await endOfColumn(tx, ctx, input.status);
  const [row] = await tx
    .insert(tasks)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      title: input.title,
      description: input.description,
      status: input.status,
      assigneeIds,
      assigneeId: assigneeIds[0] ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      position,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  return row;
}

/**
 * Full edit from the detail form. Uses optimistic concurrency: the update only
 * applies if the stored version still equals `expectedVersion`.
 */
export async function updateTask(ctx: AuthContext, input: z.output<typeof updateTaskSchema>): Promise<TaskDTO> {
  const { id, expectedVersion, patch } = input;
  let previousAssignees: string[] = [];
  const task = await getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, id);
    if (current.version !== expectedVersion) {
      throw new AppError(
        "CONFLICT",
        "Diese Aufgabe wurde inzwischen von jemand anderem geändert.",
        { current: toTaskDTO(current) },
      );
    }
    await getWritableProject(tx, ctx, current.projectId);
    previousAssignees = current.assigneeIds;
    const assigneeIds = requestedAssignees(patch) ?? current.assigneeIds;

    const next = {
      projectId: patch.projectId ?? current.projectId,
      milestoneId: patch.milestoneId !== undefined ? patch.milestoneId : current.milestoneId,
      assigneeIds,
      assigneeId: assigneeIds[0] ?? null,
      startDate: patch.startDate !== undefined ? patch.startDate : current.startDate,
      endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
      status: patch.status ?? current.status,
    };

    if (next.projectId !== current.projectId) {
      await getWritableProject(tx, ctx, next.projectId);
    }
    if (next.milestoneId && next.milestoneId !== current.milestoneId) {
      await assertMilestoneInWorkspace(tx, ctx, next.milestoneId);
    }
    await assertActiveMembers(tx, ctx, addedAssignees(current.assigneeIds, next.assigneeIds));
    if (next.startDate && next.endDate && next.endDate < next.startDate) {
      throw invalid("Das Enddatum darf nicht vor dem Startdatum liegen.", {
        endDate: "Das Enddatum darf nicht vor dem Startdatum liegen.",
      });
    }
    const position =
      next.status !== current.status ? await endOfColumn(tx, ctx, next.status) : current.position;

    const [row] = await tx
      .update(tasks)
      .set({
        ...next,
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        position,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.version, expectedVersion)))
      .returning();
    if (!row) throw new AppError("CONFLICT", "Diese Aufgabe wurde inzwischen von jemand anderem geändert.");
    return toTaskDTO(row);
  });
  notifyAssignment(ctx, task, addedAssignees(previousAssignees, task.assigneeIds));
  return task;
}

/** Quick action: change status, task goes to the end of the target column. */
export async function setTaskStatus(ctx: AuthContext, input: z.output<typeof setStatusSchema>): Promise<TaskDTO> {
  return getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, input.id);
    await getWritableProject(tx, ctx, current.projectId);
    if (current.status === input.status) return toTaskDTO(current);
    const position = await endOfColumn(tx, ctx, input.status);
    const [row] = await tx
      .update(tasks)
      .set({
        status: input.status,
        position,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(tasks.id, current.id))
      .returning();
    return toTaskDTO(row);
  });
}

/**
 * Quick action: tick or untick one checklist item (`- [ ]` ↔ `- [x]`) in the
 * description, straight from the rendered view. Applied to the *current*
 * description under a row lock, so concurrent edits elsewhere in the task or
 * the text are never overwritten; no `expectedVersion` needed. Only the one
 * character in the brackets changes. If the item can no longer be identified
 * (removed or reworded meanwhile), the caller gets CONFLICT with `current`.
 * Independent of the task status.
 */
export async function setTaskChecklistItem(
  ctx: AuthContext,
  input: z.output<typeof setChecklistItemSchema>,
): Promise<TaskDTO> {
  return getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, input.id);
    await getWritableProject(tx, ctx, current.projectId);
    const description = setChecklistItem(current.description, input.index, input.checked, input.text);
    if (description === null) {
      throw new AppError("CONFLICT", "Dieser Punkt der Checkliste wurde inzwischen geändert.", {
        current: toTaskDTO(current),
      });
    }
    if (description === current.description) return toTaskDTO(current);
    const [row] = await tx
      .update(tasks)
      .set({
        description,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(tasks.id, current.id))
      .returning();
    return toTaskDTO(row);
  });
}

/** Legacy quick action (older app builds): the one responsible person replaces all assignees. */
export async function setTaskAssignee(ctx: AuthContext, input: z.output<typeof setAssigneeSchema>): Promise<TaskDTO> {
  return setTaskAssignees(ctx, { id: input.id, assigneeIds: input.assigneeId ? [input.assigneeId] : [] });
}

/** Quick action: set everyone responsible (empty list = unassigned). Newly added people are notified. */
export async function setTaskAssignees(ctx: AuthContext, input: z.output<typeof setAssigneesSchema>): Promise<TaskDTO> {
  const assigneeIds = uniqueIds(input.assigneeIds);
  let previousAssignees: string[] = [];
  const task = await getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, input.id);
    previousAssignees = current.assigneeIds;
    await getWritableProject(tx, ctx, current.projectId);
    if (sameList(current.assigneeIds, assigneeIds)) return toTaskDTO(current);
    await assertActiveMembers(tx, ctx, addedAssignees(current.assigneeIds, assigneeIds));
    const [row] = await tx
      .update(tasks)
      .set({
        assigneeIds,
        assigneeId: assigneeIds[0] ?? null,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(tasks.id, current.id))
      .returning();
    return toTaskDTO(row);
  });
  notifyAssignment(ctx, task, addedAssignees(previousAssignees, task.assigneeIds));
  return task;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function neighbourPosition(
  tx: Tx,
  ctx: AuthContext,
  status: TaskStatus,
  excludeId: string,
  pivot: number,
  direction: "next" | "prev",
): Promise<number | null> {
  const [r] = await tx
    .select({ position: tasks.position })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        eq(tasks.status, status),
        sql`${tasks.id} <> ${excludeId}`,
        direction === "next" ? gt(tasks.position, pivot) : lt(tasks.position, pivot),
      ),
    )
    .orderBy(direction === "next" ? asc(tasks.position) : desc(tasks.position))
    .limit(1);
  return r?.position ?? null;
}

async function anchor(tx: Tx, ctx: AuthContext, id: string | null, status: TaskStatus) {
  if (!id) return null;
  const [r] = await tx
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.status, status)));
  return r ?? null; // stale or foreign anchors are ignored
}

async function computePosition(tx: Tx, ctx: AuthContext, input: z.output<typeof moveTaskSchema>) {
  const after = await anchor(tx, ctx, input.afterId, input.status);
  const before = await anchor(tx, ctx, input.beforeId, input.status);

  if (after && before && after.position < before.position) {
    return (after.position + before.position) / 2;
  }
  if (after) {
    const next = await neighbourPosition(tx, ctx, input.status, input.id, after.position, "next");
    return next === null ? after.position + POSITION_STEP : (after.position + next) / 2;
  }
  if (before) {
    const prev = await neighbourPosition(tx, ctx, input.status, input.id, before.position, "prev");
    return prev === null ? before.position - POSITION_STEP : (prev + before.position) / 2;
  }
  return endOfColumn(tx, ctx, input.status);
}

/** Re-spaces a column when fractional positions get too close. */
async function renormalizeColumn(tx: Tx, ctx: AuthContext, status: TaskStatus): Promise<void> {
  await tx.execute(sql`
    UPDATE ${tasks} AS t
       SET position = s.rn * ${POSITION_STEP}
      FROM (
        SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rn
          FROM ${tasks}
         WHERE workspace_id = ${ctx.workspaceId} AND status = ${status}
      ) s
     WHERE t.id = s.id`);
}

function tooClose(position: number, neighbours: (number | null)[]): boolean {
  return neighbours.some((n) => n !== null && Math.abs(n - position) < MIN_GAP);
}

/**
 * Drag & drop: move a task to `status`, between `afterId` and `beforeId`
 * (its visible neighbours). Hidden tasks keep their positions. Returns the
 * moved task; positions of others only change on renormalization, which is
 * delivered to clients via realtime.
 */
export async function moveTask(ctx: AuthContext, input: z.output<typeof moveTaskSchema>): Promise<TaskDTO> {
  return getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, input.id);
    await getWritableProject(tx, ctx, current.projectId);

    let position = await computePosition(tx, ctx, input);
    const prev = await neighbourPosition(tx, ctx, input.status, input.id, position, "prev");
    const next = await neighbourPosition(tx, ctx, input.status, input.id, position, "next");
    if (tooClose(position, [prev, next])) {
      await renormalizeColumn(tx, ctx, input.status);
      position = await computePosition(tx, ctx, input);
    }

    const [row] = await tx
      .update(tasks)
      .set({
        status: input.status,
        position,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(tasks.id, current.id))
      .returning();
    return toTaskDTO(row);
  });
}

export async function deleteTask(ctx: AuthContext, id: string): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    const current = await lockTask(tx, ctx, id);
    await getWritableProject(tx, ctx, current.projectId);
    await tx.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId)));
    return { id };
  });
}
