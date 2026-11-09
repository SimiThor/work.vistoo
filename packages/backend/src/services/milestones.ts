import "server-only";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { MilestoneDTO } from "@vistoo/domain";
import type {
  completeMilestoneSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
} from "@vistoo/domain/validation";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import { milestones, projects, tasks, type Milestone } from "@vistoo/database/schema";
import { AppError, notFound } from "../errors";

/**
 * Workspace-wide milestones. Every active member may create, edit, complete
 * and delete them (same as projects). Tasks of any project can be attached;
 * deleting a milestone keeps its tasks and only detaches them.
 */

type Stats = { total: number; done: number };

function toDTO(m: Milestone, stats: Stats | undefined): MilestoneDTO {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    dueDate: m.dueDate,
    completed: m.completedAt !== null,
    total: stats?.total ?? 0,
    done: stats?.done ?? 0,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Task counts per milestone (tasks of archived projects are not counted). */
async function statsFor(db: DbOrTx, ctx: AuthContext, milestoneId?: string): Promise<Map<string, Stats>> {
  const rows = await db
    .select({ milestoneId: tasks.milestoneId, status: tasks.status, n: count() })
    .from(tasks)
    .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.workspaceId, tasks.workspaceId)))
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        isNull(projects.archivedAt),
        milestoneId ? eq(tasks.milestoneId, milestoneId) : isNotNull(tasks.milestoneId),
      ),
    )
    .groupBy(tasks.milestoneId, tasks.status);
  const out = new Map<string, Stats>();
  for (const r of rows) {
    if (!r.milestoneId) continue;
    const s = out.get(r.milestoneId) ?? { total: 0, done: 0 };
    s.total += r.n;
    if (r.status === "done") s.done += r.n;
    out.set(r.milestoneId, s);
  }
  return out;
}

/** All milestones: open ones first (by due date, undated last), then completed ones. */
export async function listMilestones(ctx: AuthContext): Promise<MilestoneDTO[]> {
  const db = getDb();
  const [rows, stats] = await Promise.all([
    db
      .select()
      .from(milestones)
      .where(eq(milestones.workspaceId, ctx.workspaceId))
      .orderBy(
        sql`${milestones.completedAt} is not null`,
        sql`${milestones.dueDate} asc nulls last`,
        asc(sql`lower(${milestones.name})`),
      ),
    statsFor(db, ctx),
  ]);
  return rows.map((m) => toDTO(m, stats.get(m.id)));
}

async function load(db: DbOrTx, ctx: AuthContext, id: string): Promise<Milestone> {
  const [row] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), eq(milestones.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Meilenstein");
  return row;
}

async function lock(tx: Tx, ctx: AuthContext, id: string): Promise<Milestone> {
  const [row] = await tx
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), eq(milestones.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!row) throw notFound("Meilenstein");
  return row;
}

export async function getMilestone(ctx: AuthContext, id: string): Promise<MilestoneDTO> {
  const db = getDb();
  const row = await load(db, ctx, id);
  return toDTO(row, (await statsFor(db, ctx, id)).get(id));
}

export async function createMilestone(
  ctx: AuthContext,
  input: z.output<typeof createMilestoneSchema>,
): Promise<MilestoneDTO> {
  const db = getDb();
  if (input.id) {
    // Idempotent retry: return the caller's stored milestone.
    const [existing] = await db.select().from(milestones).where(eq(milestones.id, input.id));
    if (existing) {
      if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
        throw new AppError("CONFLICT", "Dieser Meilenstein konnte nicht angelegt werden.");
      }
      return getMilestone(ctx, existing.id);
    }
  }
  const [row] = await db
    .insert(milestones)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description,
      dueDate: input.dueDate,
      createdBy: ctx.userId,
    })
    .returning();
  return toDTO(row, undefined);
}

export async function updateMilestone(
  ctx: AuthContext,
  input: z.output<typeof updateMilestoneSchema>,
): Promise<MilestoneDTO> {
  await getDb().transaction(async (tx) => {
    await lock(tx, ctx, input.id);
    await tx
      .update(milestones)
      .set({ name: input.name, description: input.description, dueDate: input.dueDate, updatedAt: new Date() })
      .where(and(eq(milestones.id, input.id), eq(milestones.workspaceId, ctx.workspaceId)));
  });
  return getMilestone(ctx, input.id);
}

export async function setMilestoneCompleted(
  ctx: AuthContext,
  input: z.output<typeof completeMilestoneSchema>,
): Promise<MilestoneDTO> {
  await getDb().transaction(async (tx) => {
    const current = await lock(tx, ctx, input.id);
    if ((current.completedAt !== null) === input.completed) return;
    await tx
      .update(milestones)
      .set({ completedAt: input.completed ? new Date() : null, updatedAt: new Date() })
      .where(eq(milestones.id, current.id));
  });
  return getMilestone(ctx, input.id);
}

/** Deletes a milestone. Its tasks are kept and only lose the assignment. */
export async function deleteMilestone(ctx: AuthContext, id: string): Promise<{ id: string; detachedTasks: number }> {
  return getDb().transaction(async (tx) => {
    const milestone = await lock(tx, ctx, id);
    // Bump versions so open editors and realtime clients see the change.
    const detached = await tx
      .update(tasks)
      .set({ milestoneId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(tasks.milestoneId, milestone.id), eq(tasks.workspaceId, ctx.workspaceId)))
      .returning({ id: tasks.id });
    await tx.delete(milestones).where(eq(milestones.id, milestone.id));
    return { id, detachedTasks: detached.length };
  });
}
