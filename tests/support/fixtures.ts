import { randomUUID } from "node:crypto";
import { resolveMembership, type AuthContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { profiles, projectGroups, projects, workspaceMembers, workspaces } from "@/server/db/schema";

export async function makeWorkspace(name = "Vistoo") {
  const [ws] = await getDb()
    .insert(workspaces)
    .values({ name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}` })
    .returning();
  return ws;
}

export async function makeUser(opts: { email?: string; fullName?: string } = {}) {
  const id = randomUUID();
  const email = (opts.email ?? `user-${id.slice(0, 8)}@example.com`).toLowerCase();
  await getDb().insert(profiles).values({ id, email, fullName: opts.fullName ?? null });
  return { id, email };
}

export async function addMember(
  workspaceId: string,
  user: { id: string },
  role: "admin" | "member" = "member",
  status: "active" | "removed" = "active",
) {
  await getDb().insert(workspaceMembers).values({ workspaceId, userId: user.id, role, status });
}

/** Builds a context exactly like the app does: from the user id via a fresh membership lookup. */
export async function ctxFor(user: { id: string; email: string }): Promise<AuthContext> {
  const ctx = await resolveMembership(user);
  if (!ctx) throw new Error("user has no active membership");
  return ctx;
}

export async function makeMemberCtx(workspaceId: string, role: "admin" | "member" = "member") {
  const user = await makeUser();
  await addMember(workspaceId, user, role);
  return { user, ctx: await ctxFor(user) };
}

export async function makeProject(workspaceId: string, name = "Website Relaunch", archived = false) {
  const [p] = await getDb()
    .insert(projects)
    .values({ workspaceId, name, archivedAt: archived ? new Date() : null })
    .returning();
  return p;
}

export async function makeGroup(workspaceId: string, projectId: string, name = "Design") {
  const [g] = await getDb().insert(projectGroups).values({ workspaceId, projectId, name }).returning();
  return g;
}
