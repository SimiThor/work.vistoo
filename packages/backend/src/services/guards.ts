import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { AuthContext } from "../auth";
import type { DbOrTx } from "../db";
import { milestones, projects, workspaceMembers } from "@vistoo/database/schema";
import { AppError, invalid, notFound } from "../errors";

/** Loads a project of the caller's workspace. Foreign IDs behave like missing ones. */
export async function getProjectInWorkspace(db: DbOrTx, ctx: AuthContext, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  if (!project) throw notFound("Projekt");
  return project;
}

export async function getWritableProject(db: DbOrTx, ctx: AuthContext, projectId: string) {
  const project = await getProjectInWorkspace(db, ctx, projectId);
  if (project.archivedAt) {
    throw new AppError("ARCHIVED", "Dieses Projekt ist archiviert und kann nicht bearbeitet werden.");
  }
  return project;
}

export async function assertActiveMember(db: DbOrTx, ctx: AuthContext, userId: string) {
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    );
  if (!member) {
    throw invalid("Diese Person ist kein aktives Mitglied.", { assigneeId: "Ungültige Person." });
  }
}

/** All of `userIds` are active members (empty list = ok). */
export async function assertActiveMembers(db: DbOrTx, ctx: AuthContext, userIds: string[]) {
  if (!userIds.length) return;
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        inArray(workspaceMembers.userId, userIds),
        eq(workspaceMembers.status, "active"),
      ),
    );
  if (rows.length !== new Set(userIds).size) {
    throw invalid("Mindestens eine Person ist kein aktives Mitglied.", { assigneeIds: "Ungültige Person." });
  }
}

/** A milestone of the caller's workspace (completed ones included). */
export async function assertMilestoneInWorkspace(db: DbOrTx, ctx: AuthContext, milestoneId: string) {
  const [milestone] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, ctx.workspaceId)));
  if (!milestone) {
    throw invalid("Diesen Meilenstein gibt es nicht.", { milestoneId: "Ungültiger Meilenstein." });
  }
}
