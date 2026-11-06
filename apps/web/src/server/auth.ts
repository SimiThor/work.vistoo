import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { MemberRole } from "@/lib/domain";
import { getDb, type DbOrTx } from "./db";
import { workspaceMembers, workspaces } from "./db/schema";
import { AppError } from "./errors";
import { createSupabaseServerClient } from "./supabase";

/** Verified identity from Supabase Auth. Says nothing about workspace access. */
export type AuthUser = { id: string; email: string };

/**
 * Everything a service needs to authorize a request. Built exclusively on the
 * server from the verified JWT + a fresh membership lookup; never from client
 * input.
 */
export type AuthContext = {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: MemberRole;
};

/** Verifies the session JWT (signature + expiry). Deduplicated per request only. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  // Session validation depends on the current time: always request-time.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return { id: data.claims.sub, email: email.toLowerCase() };
});

/** Fresh DB lookup of the user's active membership (first workspace joined). */
export async function resolveMembership(
  user: AuthUser,
  db: DbOrTx = getDb(),
): Promise<AuthContext | null> {
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.status, "active")))
    .orderBy(asc(workspaceMembers.joinedAt))
    .limit(1);
  const m = rows[0];
  if (!m) return null;
  return {
    userId: user.id,
    email: user.email,
    workspaceId: m.workspaceId,
    workspaceName: m.workspaceName,
    role: m.role,
  };
}

const getAuthContextCached = cache(async (): Promise<AuthContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  return resolveMembership(user);
});

/** For Server Components: redirects instead of throwing. */
export async function requireMemberPage(): Promise<AuthContext> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const ctx = await getAuthContextCached();
  if (!ctx) redirect("/invite");
  return ctx;
}

/** For Server Actions / Route Handlers: throws typed errors. */
export async function requireMember(): Promise<AuthContext> {
  const user = await getAuthUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
  const ctx = await getAuthContextCached();
  if (!ctx) throw new AppError("FORBIDDEN", "Du hast keinen Zugriff mehr auf diesen Workspace.");
  return ctx;
}

export function assertAdmin(ctx: AuthContext): void {
  if (ctx.role !== "admin") {
    throw new AppError("FORBIDDEN", "Nur Admins können diese Aktion ausführen.");
  }
}
