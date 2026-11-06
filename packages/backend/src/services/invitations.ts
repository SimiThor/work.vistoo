import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import type { MemberRole } from "@vistoo/domain";
import type { AuthUser } from "../auth";
import { resolveMembership } from "../auth";
import { getDb } from "../db";
import { profiles, workspaceInvitations, workspaceMembers, workspaces } from "@vistoo/database/schema";
import { AppError } from "../errors";

/**
 * Invitation acceptance for an authenticated user WITHOUT membership.
 * The invitation must be pending, unexpired and addressed to the exact
 * (verified) e-mail of the signed-in user.
 */

export type InvitationState =
  | { kind: "member" }
  | {
      kind: "invited";
      invitation: { id: string; role: MemberRole; workspaceName: string; expiresAt: string };
      fullName: string | null;
    }
  | { kind: "expired" }
  | { kind: "none" };

export async function getInvitationState(user: AuthUser): Promise<InvitationState> {
  const db = getDb();
  if (await resolveMembership(user, db)) return { kind: "member" };
  if (!user.email) return { kind: "none" };

  const rows = await db
    .select({
      id: workspaceInvitations.id,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(and(eq(workspaceInvitations.email, user.email), eq(workspaceInvitations.status, "pending")))
    .orderBy(desc(workspaceInvitations.expiresAt));

  const valid = rows.find((r) => r.expiresAt.getTime() > Date.now());
  if (!valid) return rows.length > 0 ? { kind: "expired" } : { kind: "none" };

  const [profile] = await db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, user.id));
  return {
    kind: "invited",
    invitation: {
      id: valid.id,
      role: valid.role,
      workspaceName: valid.workspaceName,
      expiresAt: valid.expiresAt.toISOString(),
    },
    fullName: profile?.fullName ?? null,
  };
}

/** Pre-auth check used by the login flow; reveals nothing to the caller. */
export async function hasValidPendingInvitation(email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: workspaceInvitations.id })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.email, email.trim().toLowerCase()),
        eq(workspaceInvitations.status, "pending"),
        gt(workspaceInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function acceptInvitation(
  user: AuthUser,
  input: { invitationId: string; fullName: string },
): Promise<void> {
  if (!user.email) throw new AppError("FORBIDDEN", "Dein Konto hat keine bestätigte E-Mail-Adresse.");
  await getDb().transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, input.invitationId))
      .for("update");

    // Same message for every failure: do not reveal other people's invitations.
    const denied = new AppError("FORBIDDEN", "Diese Einladung ist nicht (mehr) gültig.");
    if (!inv || inv.status !== "pending" || inv.email !== user.email.toLowerCase()) throw denied;
    if (inv.expiresAt.getTime() <= Date.now()) throw denied;

    const now = new Date();
    await tx
      .insert(profiles)
      .values({ id: user.id, email: user.email, fullName: input.fullName })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { email: user.email, fullName: input.fullName, updatedAt: now },
      });

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role, status: "active", joinedAt: now })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: inv.role, status: "active", removedAt: null, joinedAt: now, updatedAt: now },
      });

    await tx
      .update(workspaceInvitations)
      .set({ status: "accepted", acceptedAt: now, acceptedBy: user.id, updatedAt: now })
      .where(eq(workspaceInvitations.id, inv.id));
  });
}
