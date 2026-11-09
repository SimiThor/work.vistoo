import "server-only";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { TaskDTO } from "@vistoo/domain";
import type { createIdeaSchema, createIssueFromIdeaSchema, IdeaDTO, updateIdeaSchema } from "@vistoo/domain/ideas";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx } from "../db";
import { ideas, tasks, type Idea } from "@vistoo/database/schema";
import { AppError, notFound } from "../errors";
import { assertActiveMember } from "./guards";
import { insertTask, toTaskDTO } from "./tasks";

/** Shared idea backlog: every active member of the workspace may read and change ideas. */

type IdeaRow = { idea: Idea; task: { id: string; number: number; title: string; projectId: string } | null };

function toIdeaDTO({ idea, task }: IdeaRow): IdeaDTO {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    status: idea.status,
    createdBy: idea.createdBy,
    assigneeId: idea.assigneeId,
    task: task?.id ? task : null,
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
  };
}

function selectIdeas(db: DbOrTx, ctx: AuthContext, extra?: SQL) {
  return db
    .select({ idea: ideas, task: { id: tasks.id, number: tasks.number, title: tasks.title, projectId: tasks.projectId } })
    .from(ideas)
    .leftJoin(tasks, and(eq(tasks.id, ideas.taskId), eq(tasks.workspaceId, ideas.workspaceId)))
    .where(and(eq(ideas.workspaceId, ctx.workspaceId), extra));
}

async function getIdea(db: DbOrTx, ctx: AuthContext, id: string): Promise<IdeaDTO> {
  const [row] = await selectIdeas(db, ctx, eq(ideas.id, id));
  if (!row) throw notFound("Idee");
  return toIdeaDTO(row as IdeaRow);
}

async function lockIdea(db: DbOrTx, ctx: AuthContext, id: string): Promise<Idea> {
  const [row] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!row) throw notFound("Idee");
  return row;
}

/** Newest first (the UI can reverse). */
export async function listIdeas(ctx: AuthContext): Promise<IdeaDTO[]> {
  const rows = await selectIdeas(getDb(), ctx).orderBy(desc(ideas.createdAt), desc(ideas.id));
  return (rows as IdeaRow[]).map(toIdeaDTO);
}

export async function createIdea(ctx: AuthContext, input: z.output<typeof createIdeaSchema>): Promise<IdeaDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(ideas).where(eq(ideas.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
          throw new AppError("CONFLICT", "Diese Idee konnte nicht angelegt werden.");
        }
        return getIdea(tx, ctx, existing.id);
      }
    }
    if (input.assigneeId) await assertActiveMember(tx, ctx, input.assigneeId);
    const [row] = await tx
      .insert(ideas)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        title: input.title,
        description: input.description,
        status: input.status,
        assigneeId: input.assigneeId,
        createdBy: ctx.userId,
      })
      .returning();
    return toIdeaDTO({ idea: row, task: null });
  });
}

/** Partial update: only the sent fields change (concurrent edits of other fields are kept). */
export async function updateIdea(ctx: AuthContext, input: z.output<typeof updateIdeaSchema>): Promise<IdeaDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await lockIdea(tx, ctx, id);
    if (patch.assigneeId && patch.assigneeId !== current.assigneeId) await assertActiveMember(tx, ctx, patch.assigneeId);
    await tx
      .update(ideas)
      .set({
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        status: patch.status ?? current.status,
        assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : current.assigneeId,
        updatedAt: new Date(),
      })
      .where(and(eq(ideas.id, id), eq(ideas.workspaceId, ctx.workspaceId)));
    return getIdea(tx, ctx, id);
  });
}

export async function deleteIdea(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const deleted = await getDb()
    .delete(ideas)
    .where(and(eq(ideas.id, id), eq(ideas.workspaceId, ctx.workspaceId)))
    .returning({ id: ideas.id });
  if (deleted.length === 0) throw notFound("Idee");
  return { id };
}

/**
 * "Issue erstellen": creates a regular task (the same insert as everywhere
 * else) with the idea's title and description in the chosen project and
 * links it to the idea — in one transaction. Repeating it returns the issue
 * that already exists instead of creating a second one.
 */
export async function createIssueFromIdea(
  ctx: AuthContext,
  input: z.output<typeof createIssueFromIdeaSchema>,
): Promise<{ idea: IdeaDTO; task: TaskDTO }> {
  return getDb().transaction(async (tx) => {
    const idea = await lockIdea(tx, ctx, input.ideaId);
    if (idea.taskId) {
      const [existing] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, idea.taskId), eq(tasks.workspaceId, ctx.workspaceId)));
      if (existing) return { idea: await getIdea(tx, ctx, idea.id), task: toTaskDTO(existing) };
    }
    const task = await insertTask(tx, ctx, {
      projectId: input.projectId,
      title: idea.title,
      description: idea.description,
      status: "open",
      milestoneId: null,
      assigneeId: null,
      startDate: null,
      endDate: null,
    });
    await tx
      .update(ideas)
      .set({ taskId: task.id, updatedAt: new Date() })
      .where(and(eq(ideas.id, idea.id), eq(ideas.workspaceId, ctx.workspaceId)));
    return { idea: await getIdea(tx, ctx, idea.id), task: toTaskDTO(task) };
  });
}
