import "server-only";
import { cache } from "react";
import { requireMemberPage } from "./auth";
import { listProjects } from "@vistoo/backend/services/projects";
import { getViewerProfile } from "@vistoo/backend/services/session";
import { listFormerMembers, listMembers } from "@vistoo/backend/services/team";

/**
 * Request-scoped loaders for Server Components (React cache = per request,
 * never shared between users or sessions).
 */

export const getViewer = cache(async () => {
  const ctx = await requireMemberPage();
  const viewer = await getViewerProfile(ctx);
  return {
    ctx,
    me: { userId: viewer.userId, email: viewer.email, fullName: viewer.fullName, role: viewer.role },
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
