import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { INVITATION_TTL_DAYS, type InvitationDTO, type MemberDTO } from "@/lib/domain";
import type { changeRoleSchema, inviteSchema, profileNameSchema } from "@/lib/validation";
import { assertAdmin, type AuthContext } from "../auth";
import { getDb, type Tx } from "../db";
import { profiles, tasks, workspaceInvitations, workspaceMembers } from "../db/schema";
import { AppError, invalid, notFound } from "../errors";
import { sendInvitationEmail } from "../mailer";

export type TeamOverview = { members: MemberDTO[]; invitations: InvitationDTO[] };

export function invitationExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 86_400_000);
}

/** Active members (for assignee pickers, filters and the team list). */
export async function listMembers(ctx: AuthContext): Promise<MemberDTO[]> {
  const rows = await getDb()
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      email: profiles.email,
      fullName: profiles.fullName,
    })
    .from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.status, "active")))
    .orderBy(asc(sql`lower(coalesce(${profiles.fullName}, ${profiles.email}))`));
  return rows.map((r) => ({ ...r, active: true }));
}

/**
 * People who ever created tasks but are no longer members — needed to show
 * historical creator names.
 */
export async function listFormerMembers(ctx: AuthContext): Promise<MemberDTO[]> {
  const rows = await getDb()
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      email: profiles.email,
      fullName: profiles.fullName,
    })
    .from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.status, "removed")));
  return rows.map((r) => ({ ...r, active: false }));
}

export async function listTeam(ctx: AuthContext): Promise<TeamOverview> {
  const db = getDb();
  const [members, invitationRows] = await Promise.all([
    listMembers(ctx),
    db
      .select()
      .from(workspaceInvitations)
      .where(
        and(eq(workspaceInvitations.workspaceId, ctx.workspaceId), eq(workspaceInvitations.status, "pending")),
      )
      .orderBy(asc(workspaceInvitations.email)),
  ]);
  const now = Date.now();
  return {
    members,
    invitations: invitationRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      lastSentAt: i.lastSentAt.toISOString(),
      expired: i.expiresAt.getTime() <= now,
    })),
  };
}

type Deps = { send: (email: string) => Promise<void> };
const defaultDeps: Deps = { send: sendInvitationEmail };

const SEND_FAILED = "Die Einladungs-E-Mail konnte nicht versendet werden. Bitte versuche es später erneut.";

/** Admin: invite an e-mail address. The e-mail is sent inside the transaction; failure rolls back. */
export async function inviteMember(
  ctx: AuthContext,
  input: z.output<typeof inviteSchema>,
  deps: Deps = defaultDeps,
): Promise<InvitationDTO> {
  assertAdmin(ctx);
  input = { ...input, email: input.email.trim().toLowerCase() };
  return getDb().transaction(async (tx) => {
    const [existingMember] = await tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, ctx.workspaceId),
          eq(workspaceMembers.status, "active"),
          sql`lower(${profiles.email}) = ${input.email}`,
        ),
      );
    if (existingMember) {
      throw invalid("Diese Person ist bereits Mitglied.", { email: "Bereits Mitglied." });
    }
    const [pending] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, ctx.workspaceId),
          eq(workspaceInvitations.email, input.email),
          eq(workspaceInvitations.status, "pending"),
        ),
      );
    if (pending) {
      throw invalid("Für diese Adresse gibt es bereits eine offene Einladung.", {
        email: "Bereits eingeladen – du kannst die Einladung erneut senden.",
      });
    }
    const now = new Date();
    const [row] = await tx
      .insert(workspaceInvitations)
      .values({
        workspaceId: ctx.workspaceId,
        email: input.email,
        role: input.role,
        invitedBy: ctx.userId,
        expiresAt: invitationExpiry(now),
        lastSentAt: now,
      })
      .returning();
    try {
      await deps.send(input.email);
    } catch (err) {
      console.error("[invite] send failed:", err instanceof Error ? err.message : String(err));
      throw new AppError("INTERNAL", SEND_FAILED);
    }
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expiresAt.toISOString(),
      lastSentAt: row.lastSentAt.toISOString(),
      expired: false,
    };
  });
}

async function lockPendingInvitation(tx: Tx, ctx: AuthContext, id: string) {
  const [inv] = await tx
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, id),
        eq(workspaceInvitations.workspaceId, ctx.workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .for("update");
  if (!inv) throw notFound("Einladung");
  return inv;
}

/** Admin: resend → renews the expiry. */
export async function resendInvitation(ctx: AuthContext, id: string, deps: Deps = defaultDeps): Promise<void> {
  assertAdmin(ctx);
  await getDb().transaction(async (tx) => {
    const inv = await lockPendingInvitation(tx, ctx, id);
    const now = new Date();
    await tx
      .update(workspaceInvitations)
      .set({ expiresAt: invitationExpiry(now), lastSentAt: now, updatedAt: now })
      .where(eq(workspaceInvitations.id, inv.id));
    try {
      await deps.send(inv.email);
    } catch (err) {
      console.error("[invite] resend failed:", err instanceof Error ? err.message : String(err));
      throw new AppError("INTERNAL", SEND_FAILED);
    }
  });
}

export async function revokeInvitation(ctx: AuthContext, id: string): Promise<void> {
  assertAdmin(ctx);
  await getDb().transaction(async (tx) => {
    const inv = await lockPendingInvitation(tx, ctx, id);
    const now = new Date();
    await tx
      .update(workspaceInvitations)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(eq(workspaceInvitations.id, inv.id));
  });
}

/** Locks all active admin rows of the workspace (serializes admin changes). */
async function lockActiveAdmins(tx: Tx, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "admin"),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .for("update");
  return rows.map((r) => r.userId);
}

async function lockActiveMember(tx: Tx, ctx: AuthContext, userId: string) {
  const [m] = await tx
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .for("update");
  if (!m) throw notFound("Mitglied");
  return m;
}

const LAST_ADMIN_MSG = "Der letzte Admin kann nicht entfernt oder herabgestuft werden.";

export async function changeMemberRole(ctx: AuthContext, input: z.output<typeof changeRoleSchema>): Promise<void> {
  assertAdmin(ctx);
  await getDb().transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx, ctx.workspaceId);
    const target = await lockActiveMember(tx, ctx, input.userId);
    if (target.role === input.role) return;
    if (target.role === "admin" && input.role !== "admin" && admins.length <= 1) {
      throw new AppError("LAST_ADMIN", LAST_ADMIN_MSG);
    }
    await tx
      .update(workspaceMembers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, input.userId)));
  });
}

/**
 * Removes a member: access ends immediately (every request re-checks the
 * membership; RLS stops realtime delivery), tasks stay, current assignments
 * become "unassigned", creator history is kept (profiles are never deleted).
 */
export async function removeMember(ctx: AuthContext, userId: string): Promise<{ unassignedTasks: number }> {
  assertAdmin(ctx);
  return getDb().transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx, ctx.workspaceId);
    const target = await lockActiveMember(tx, ctx, userId);
    if (target.role === "admin" && admins.length <= 1) {
      throw new AppError("LAST_ADMIN", LAST_ADMIN_MSG);
    }
    const now = new Date();
    const unassigned = await tx
      .update(tasks)
      .set({ assigneeId: null, version: sql`${tasks.version} + 1`, updatedAt: now, updatedBy: ctx.userId })
      .where(and(eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.assigneeId, userId)))
      .returning({ id: tasks.id });
    await tx
      .update(workspaceMembers)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
    return { unassignedTasks: unassigned.length };
  });
}

export async function updateOwnName(ctx: AuthContext, input: z.output<typeof profileNameSchema>): Promise<void> {
  await getDb()
    .update(profiles)
    .set({ fullName: input.fullName, updatedAt: new Date() })
    .where(eq(profiles.id, ctx.userId));
}
