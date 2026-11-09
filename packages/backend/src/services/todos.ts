import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, min, sql } from "drizzle-orm";
import type { z } from "zod";
import { TODO_LIMITS, type TodoDTO, type createTodoSchema, type reorderTodosSchema, type updateTodoSchema } from "@vistoo/domain/todos";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx } from "../db";
import { personalTodos, type PersonalTodo } from "@vistoo/database/schema";
import { AppError, invalid, notFound } from "../errors";

/**
 * Personal to-dos. Private: every query is scoped to the caller (workspace +
 * user id from the verified session), so other people's ids behave like
 * missing ones — also for admins.
 */

const POSITION_STEP = 1024;

export function toTodoDTO(t: PersonalTodo): TodoDTO {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    completed: t.completedAt !== null,
    completedAt: t.completedAt?.toISOString() ?? null,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const own = (ctx: AuthContext) =>
  and(eq(personalTodos.workspaceId, ctx.workspaceId), eq(personalTodos.userId, ctx.userId));

async function findOwn(db: DbOrTx, ctx: AuthContext, id: string, lock = false): Promise<PersonalTodo> {
  const q = db.select().from(personalTodos).where(and(eq(personalTodos.id, id), own(ctx)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("To-do");
  return row;
}

/** Open to-dos by position, then completed ones (most recently completed first). */
export async function listTodos(ctx: AuthContext): Promise<TodoDTO[]> {
  const rows = await getDb()
    .select()
    .from(personalTodos)
    .where(own(ctx))
    .orderBy(
      sql`${personalTodos.completedAt} is not null`,
      asc(personalTodos.position),
      desc(personalTodos.completedAt),
      asc(personalTodos.createdAt),
    );
  return rows.map(toTodoDTO);
}

/** New to-dos go to the top of the open list. */
export async function createTodo(ctx: AuthContext, input: z.output<typeof createTodoSchema>): Promise<TodoDTO> {
  return getDb().transaction(async (tx) => {
    // Serialize creates per user (limit + top position).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`todos:${ctx.workspaceId}:${ctx.userId}`}))`);
    if (input.id) {
      const [existing] = await tx.select().from(personalTodos).where(eq(personalTodos.id, input.id));
      if (existing) {
        if (existing.userId !== ctx.userId || existing.workspaceId !== ctx.workspaceId) {
          throw new AppError("CONFLICT", "Dieses To-do konnte nicht angelegt werden.");
        }
        return toTodoDTO(existing);
      }
    }
    const [stats] = await tx
      .select({ n: count(), top: min(personalTodos.position) })
      .from(personalTodos)
      .where(own(ctx));
    if (stats.n >= TODO_LIMITS.perUser) {
      throw invalid(`Du kannst höchstens ${TODO_LIMITS.perUser} To-dos haben. Lösche erledigte Einträge.`);
    }
    const [row] = await tx
      .insert(personalTodos)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        position: (stats.top ?? POSITION_STEP) - POSITION_STEP,
      })
      .returning();
    return toTodoDTO(row);
  });
}

export async function updateTodo(ctx: AuthContext, input: z.output<typeof updateTodoSchema>): Promise<TodoDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await findOwn(tx, ctx, id, true);
    const completedAt =
      patch.completed === undefined
        ? current.completedAt
        : patch.completed
          ? (current.completedAt ?? new Date())
          : null;
    const [row] = await tx
      .update(personalTodos)
      .set({
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        dueDate: patch.dueDate !== undefined ? patch.dueDate : current.dueDate,
        completedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(personalTodos.id, id), own(ctx)))
      .returning();
    return toTodoDTO(row);
  });
}

export async function deleteTodo(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const deleted = await getDb()
    .delete(personalTodos)
    .where(and(eq(personalTodos.id, id), own(ctx)))
    .returning({ id: personalTodos.id });
  if (deleted.length === 0) throw notFound("To-do");
  return { id };
}

/**
 * Drag & drop: the open to-dos in their new order (top to bottom). Ids of
 * other people or unknown ids are rejected as a whole.
 */
export async function reorderTodos(ctx: AuthContext, input: z.output<typeof reorderTodosSchema>): Promise<TodoDTO[]> {
  const ids = [...new Set(input.ids)];
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: personalTodos.id })
      .from(personalTodos)
      .where(and(own(ctx), inArray(personalTodos.id, ids), isNull(personalTodos.completedAt)))
      .for("update");
    if (rows.length !== ids.length) throw notFound("To-do");
    for (const [i, todoId] of ids.entries()) {
      await tx
        .update(personalTodos)
        .set({ position: (i + 1) * POSITION_STEP })
        .where(and(eq(personalTodos.id, todoId), own(ctx)));
    }
    const updated = await tx.select().from(personalTodos).where(and(own(ctx), inArray(personalTodos.id, ids)));
    return updated.sort((a, b) => a.position - b.position).map(toTodoDTO);
  });
}
