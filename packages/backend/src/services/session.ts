import "server-only";
import { eq } from "drizzle-orm";
import type { MemberRole } from "@vistoo/domain";
import { profiles } from "@vistoo/database/schema";
import { resolveMembership, type AuthContext, type AuthUser } from "../auth";
import { getDb } from "../db";
import { getInvitationState } from "./invitations";

export type Viewer = {
  userId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  workspaceId: string;
  workspaceName: string;
};

/** The signed-in member with profile data (web shell and API bootstrap). */
export async function getViewerProfile(ctx: AuthContext): Promise<Viewer> {
  const [profile] = await getDb()
    .select({ email: profiles.email, fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, ctx.userId));
  return {
    userId: ctx.userId,
    email: profile?.email ?? ctx.email,
    fullName: profile?.fullName ?? null,
    role: ctx.role,
    workspaceId: ctx.workspaceId,
    workspaceName: ctx.workspaceName,
  };
}

export type MeState = {
  userId: string;
  email: string;
  fullName: string | null;
  access: "member" | "invited" | "expired" | "none";
  viewer: Viewer | null;
  invitation: { id: string; role: MemberRole; workspaceName: string; expiresAt: string } | null;
};

/**
 * Access state of an authenticated user, with or without membership — the
 * same decision the web makes between /tasks and /invite.
 */
export async function getMe(user: AuthUser): Promise<MeState> {
  const ctx = await resolveMembership(user);
  if (ctx) {
    const viewer = await getViewerProfile(ctx);
    return { userId: user.id, email: viewer.email, fullName: viewer.fullName, access: "member", viewer, invitation: null };
  }
  const state = await getInvitationState(user);
  const base = { userId: user.id, email: user.email, viewer: null };
  switch (state.kind) {
    case "invited":
      return { ...base, fullName: state.fullName, access: "invited", invitation: state.invitation };
    case "expired":
      return { ...base, fullName: null, access: "expired", invitation: null };
    case "member": // membership appeared between the two lookups
      return getMe(user);
    default:
      return { ...base, fullName: null, access: "none", invitation: null };
  }
}
