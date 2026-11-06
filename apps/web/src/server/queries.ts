import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { requireMemberPage } from "./auth";
import { getDb } from "./db";
import { profiles } from "./db/schema";
import { listProjects } from "./services/projects";
import { listFormerMembers, listMembers } from "./services/team";

/**
 * Request-scoped loaders for Server Components (React cache = per request,
 * never shared between users or sessions).
 */

export const getViewer = cache(async () => {
  const ctx = await requireMemberPage();
  const [profile] = await getDb()
    .select({ email: profiles.email, fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, ctx.userId));
  return {
    ctx,
    me: { userId: ctx.userId, email: profile?.email ?? ctx.email, fullName: profile?.fullName ?? null, role: ctx.role },
  };
});

export const getProjectsForViewer = cache(async () => {
  const { ctx } = await getViewer();
  return listProjects(ctx);
});

export const getPeopleForViewer = cache(async () => {
  const { ctx } = await getViewer();
  const [members, former] = await Promise.all([listMembers(ctx), listFormerMembers(ctx)]);
  return { members, former };
});
