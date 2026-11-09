import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import type { z } from "zod";
import type { TaskLinkDTO } from "@vistoo/domain/dto";
import { LINK_LIMITS } from "@vistoo/domain/links";
import type { createTaskLinkSchema, updateTaskLinkSchema } from "@vistoo/domain/validation";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import { taskLinks, tasks, type TaskLink } from "@vistoo/database/schema";
import { AppError, notFound } from "../errors";
import { getProjectInWorkspace, getWritableProject } from "./guards";

/**
 * External links attached to tasks ("Anhänge"). Same rules as editing the
 * task itself: every active member may manage them, archived projects are
 * read-only, foreign ids behave like missing ones.
 */

export function toTaskLinkDTO(l: TaskLink): TaskLinkDTO {
  return {
    id: l.id,
    taskId: l.taskId,
    url: l.url,
    title: l.title,
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

const titleOrNull = (title: string | null) => (title ? title : null);

async function findTask(db: DbOrTx, ctx: AuthContext, taskId: string, lock = false) {
  const q = db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ctx.workspaceId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Aufgabe");
  return row;
}

/** Locks the task (serializes link changes per task) and checks it is writable. */
async function writableTask(tx: Tx, ctx: AuthContext, taskId: string) {
  const task = await findTask(tx, ctx, taskId, true);
  await getWritableProject(tx, ctx, task.projectId);
  return task;
}

async function findLink(db: DbOrTx, ctx: AuthContext, id: string): Promise<TaskLink> {
  const [row] = await db
    .select()
    .from(taskLinks)
    .where(and(eq(taskLinks.id, id), eq(taskLinks.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Anhang");
  return row;
}

/** Links of a task, oldest first (also for tasks of archived projects). */
export async function listTaskLinks(ctx: AuthContext, taskId: string): Promise<TaskLinkDTO[]> {
  const db = getDb();
  const task = await findTask(db, ctx, taskId);
  await getProjectInWorkspace(db, ctx, task.projectId);
  const rows = await db
    .select()
    .from(taskLinks)
    .where(and(eq(taskLinks.taskId, taskId), eq(taskLinks.workspaceId, ctx.workspaceId)))
    .orderBy(asc(taskLinks.createdAt), asc(taskLinks.id));
  return rows.map(toTaskLinkDTO);
}

export async function createTaskLink(
  ctx: AuthContext,
  input: z.output<typeof createTaskLinkSchema>,
): Promise<TaskLinkDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      // Retried create: return the stored link if it is the caller's own.
      const [existing] = await tx.select().from(taskLinks).where(eq(taskLinks.id, input.id));
      if (existing) {
        if (
          existing.workspaceId !== ctx.workspaceId ||
          existing.createdBy !== ctx.userId ||
          existing.taskId !== input.taskId
        ) {
          throw new AppError("CONFLICT", "Dieser Anhang konnte nicht angelegt werden.");
        }
        return toTaskLinkDTO(existing);
      }
    }
    await writableTask(tx, ctx, input.taskId);
    const [{ n }] = await tx
      .select({ n: count() })
      .from(taskLinks)
      .where(and(eq(taskLinks.taskId, input.taskId), eq(taskLinks.workspaceId, ctx.workspaceId)));
    if (n >= LINK_LIMITS.perTask) {
      throw new AppError("VALIDATION", `Eine Aufgabe kann höchstens ${LINK_LIMITS.perTask} Anhänge haben.`);
    }
    const [row] = await tx
      .insert(taskLinks)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        taskId: input.taskId,
        url: input.url,
        title: titleOrNull(input.title),
        createdBy: ctx.userId,
      })
      .returning();
    return toTaskLinkDTO(row);
  });
}

export async function updateTaskLink(
  ctx: AuthContext,
  input: z.output<typeof updateTaskLinkSchema>,
): Promise<TaskLinkDTO> {
  return getDb().transaction(async (tx) => {
    const current = await findLink(tx, ctx, input.id);
    await writableTask(tx, ctx, current.taskId);
    const [row] = await tx
      .update(taskLinks)
      .set({ url: input.url, title: titleOrNull(input.title), updatedAt: new Date() })
      .where(and(eq(taskLinks.id, current.id), eq(taskLinks.workspaceId, ctx.workspaceId)))
      .returning();
    if (!row) throw notFound("Anhang");
    return toTaskLinkDTO(row);
  });
}

export async function deleteTaskLink(ctx: AuthContext, id: string): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    const current = await findLink(tx, ctx, id);
    await writableTask(tx, ctx, current.taskId);
    await tx.delete(taskLinks).where(and(eq(taskLinks.id, id), eq(taskLinks.workspaceId, ctx.workspaceId)));
    return { id };
  });
}
