import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { ProjectDTO } from "@vistoo/domain";
import type {
  archiveProjectSchema,
  createProjectSchema,
  updateProjectSchema,
} from "@vistoo/domain/validation";
import type { AuthContext } from "../auth";
import { getDb, type Tx } from "../db";
import { projects, tasks, type Project } from "@vistoo/database/schema";
import { AppError, notFound } from "../errors";
import { getProjectInWorkspace, getWritableProject } from "./guards";

function toProjectDTO(p: Project): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    archived: p.archivedAt !== null,
    groups: [], // groups were removed; kept in API v1 for older app builds
  };
}

/** All projects (incl. archived, flagged). */
export async function listProjects(ctx: AuthContext): Promise<ProjectDTO[]> {
  const rows = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, ctx.workspaceId))
    .orderBy(asc(sql`lower(${projects.name})`));
  return rows.map(toProjectDTO);
}

export type ProjectStats = Record<string, { total: number; done: number }>;

export async function projectStats(ctx: AuthContext): Promise<ProjectStats> {
  const rows = await getDb()
    .select({ projectId: tasks.projectId, status: tasks.status, n: count() })
    .from(tasks)
    .where(eq(tasks.workspaceId, ctx.workspaceId))
    .groupBy(tasks.projectId, tasks.status);
  const out: ProjectStats = {};
  for (const r of rows) {
    const s = (out[r.projectId] ??= { total: 0, done: 0 });
    s.total += r.n;
    if (r.status === "done") s.done += r.n;
  }
  return out;
}

export async function getProject(ctx: AuthContext, id: string): Promise<ProjectDTO> {
  const db = getDb();
  const project = await getProjectInWorkspace(db, ctx, id);
  return toProjectDTO(project);
}

export async function createProject(
  ctx: AuthContext,
  input: z.output<typeof createProjectSchema>,
): Promise<ProjectDTO> {
  if (input.id) {
    // Idempotent retry: return the caller's stored project.
    const [existing] = await getDb().select().from(projects).where(eq(projects.id, input.id));
    if (existing) {
      if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
        throw new AppError("CONFLICT", "Dieses Projekt konnte nicht angelegt werden.");
      }
      return getProject(ctx, existing.id);
    }
  }
  const [row] = await getDb()
    .insert(projects)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description,
      color: input.color,
      createdBy: ctx.userId,
    })
    .returning();
  return toProjectDTO(row);
}

export async function updateProject(ctx: AuthContext, input: z.output<typeof updateProjectSchema>): Promise<ProjectDTO> {
  return getDb().transaction(async (tx) => {
    await getWritableProject(tx, ctx, input.id);
    await tx
      .update(projects)
      .set({ name: input.name, description: input.description, color: input.color, updatedAt: new Date() })
      .where(and(eq(projects.id, input.id), eq(projects.workspaceId, ctx.workspaceId)));
    return getProject(ctx, input.id);
  });
}

export async function setProjectArchived(
  ctx: AuthContext,
  input: z.output<typeof archiveProjectSchema>,
): Promise<ProjectDTO> {
  const db = getDb();
  await getProjectInWorkspace(db, ctx, input.id);
  await db
    .update(projects)
    .set({ archivedAt: input.archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(projects.id, input.id), eq(projects.workspaceId, ctx.workspaceId)));
  return getProject(ctx, input.id);
}
