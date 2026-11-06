import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { GroupDTO, ProjectDTO } from "@vistoo/domain";
import type {
  archiveProjectSchema,
  createGroupSchema,
  createProjectSchema,
  renameGroupSchema,
  updateProjectSchema,
} from "@vistoo/domain/validation";
import type { AuthContext } from "../auth";
import { getDb, type Tx } from "../db";
import { projectGroups, projects, tasks, type Project, type ProjectGroup } from "@vistoo/database/schema";
import { AppError, notFound } from "../errors";
import { getProjectInWorkspace, getWritableProject } from "./guards";

function toGroupDTO(g: ProjectGroup): GroupDTO {
  return { id: g.id, projectId: g.projectId, name: g.name, position: g.position };
}

function toProjectDTO(p: Project, groups: ProjectGroup[]): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    archived: p.archivedAt !== null,
    groups: groups.filter((g) => g.projectId === p.id).map(toGroupDTO),
  };
}

/** All projects (incl. archived, flagged) with their groups. */
export async function listProjects(ctx: AuthContext): Promise<ProjectDTO[]> {
  const db = getDb();
  const [projectRows, groupRows] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, ctx.workspaceId))
      .orderBy(asc(sql`lower(${projects.name})`)),
    db
      .select()
      .from(projectGroups)
      .where(eq(projectGroups.workspaceId, ctx.workspaceId))
      .orderBy(asc(projectGroups.position), asc(sql`lower(${projectGroups.name})`)),
  ]);
  return projectRows.map((p) => toProjectDTO(p, groupRows));
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
  const groups = await db
    .select()
    .from(projectGroups)
    .where(and(eq(projectGroups.projectId, id), eq(projectGroups.workspaceId, ctx.workspaceId)))
    .orderBy(asc(projectGroups.position), asc(sql`lower(${projectGroups.name})`));
  return toProjectDTO(project, groups);
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
  return toProjectDTO(row, []);
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

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function createGroup(ctx: AuthContext, input: z.output<typeof createGroupSchema>): Promise<GroupDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(projectGroups).where(eq(projectGroups.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.projectId !== input.projectId) {
          throw new AppError("CONFLICT", "Diese Gruppe konnte nicht angelegt werden.");
        }
        return toGroupDTO(existing);
      }
    }
    await getWritableProject(tx, ctx, input.projectId);
    const [r] = await tx
      .select({ max: sql<number | null>`max(${projectGroups.position})` })
      .from(projectGroups)
      .where(eq(projectGroups.projectId, input.projectId));
    const [row] = await tx
      .insert(projectGroups)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        name: input.name,
        position: (r?.max ?? 0) + 1024,
      })
      .returning();
    return toGroupDTO(row);
  });
}

async function lockGroup(tx: Tx, ctx: AuthContext, id: string) {
  const [group] = await tx
    .select()
    .from(projectGroups)
    .where(and(eq(projectGroups.id, id), eq(projectGroups.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!group) throw notFound("Gruppe");
  return group;
}

export async function renameGroup(ctx: AuthContext, input: z.output<typeof renameGroupSchema>): Promise<GroupDTO> {
  return getDb().transaction(async (tx) => {
    const group = await lockGroup(tx, ctx, input.id);
    await getWritableProject(tx, ctx, group.projectId);
    const [row] = await tx
      .update(projectGroups)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(projectGroups.id, group.id))
      .returning();
    return toGroupDTO(row);
  });
}

/** Deletes a group. Its tasks are kept and only lose the group assignment. */
export async function deleteGroup(ctx: AuthContext, id: string): Promise<{ id: string; detachedTasks: number }> {
  return getDb().transaction(async (tx) => {
    const group = await lockGroup(tx, ctx, id);
    await getWritableProject(tx, ctx, group.projectId);
    const detached = await tx
      .update(tasks)
      .set({ groupId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(tasks.groupId, group.id), eq(tasks.workspaceId, ctx.workspaceId)))
      .returning({ id: tasks.id });
    await tx.delete(projectGroups).where(eq(projectGroups.id, group.id));
    return { id, detachedTasks: detached.length };
  });
}
