import "server-only";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "../auth";
import type { DbOrTx } from "../db";
import { projectGroups, projects, workspaceMembers } from "../db/schema";
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

export async function assertGroupInProject(db: DbOrTx, ctx: AuthContext, groupId: string, projectId: string) {
  const [group] = await db
    .select({ id: projectGroups.id })
    .from(projectGroups)
    .where(
      and(
        eq(projectGroups.id, groupId),
        eq(projectGroups.projectId, projectId),
        eq(projectGroups.workspaceId, ctx.workspaceId),
      ),
    );
  if (!group) {
    throw invalid("Die Gruppe gehört nicht zu diesem Projekt.", { groupId: "Ungültige Gruppe." });
  }
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
