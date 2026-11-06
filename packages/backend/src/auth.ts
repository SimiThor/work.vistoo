import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { MemberRole } from "@vistoo/domain";
import { workspaceMembers, workspaces } from "@vistoo/database/schema";
import { getDb, type DbOrTx } from "./db";
import { AppError } from "./errors";
import { createSupabaseAnonClient } from "./supabase";

/**
 * Identity and authorization context. Framework-agnostic: the web app builds
 * an AuthUser from the session cookie, the HTTP API (/api/v1) from a bearer
 * access token. Both then go through the same membership lookup.
 */

/** Verified identity from Supabase Auth. Says nothing about workspace access. */
export type AuthUser = { id: string; email: string };

/**
 * Everything a service needs to authorize a request. Built exclusively on the
 * server from a verified JWT + a fresh membership lookup; never from client
 * input.
 */
export type AuthContext = {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: MemberRole;
};

/** Fresh DB lookup of the user's active membership (first workspace joined). */
export async function resolveMembership(user: AuthUser, db: DbOrTx = getDb()): Promise<AuthContext | null> {
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

export function assertAdmin(ctx: AuthContext): void {
  if (ctx.role !== "admin") {
    throw new AppError("FORBIDDEN", "Nur Admins können diese Aktion ausführen.");
  }
}

export const sessionExpired = () =>
  new AppError("UNAUTHENTICATED", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
export const accessRevoked = () => new AppError("FORBIDDEN", "Du hast keinen Zugriff mehr auf diesen Workspace.");

/** Turns verified claims into an AuthUser (shared by cookie and bearer flows). */
export function authUserFromClaims(claims: { sub?: unknown; email?: unknown } | null | undefined): AuthUser | null {
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : "";
  return { id: claims.sub, email: email.toLowerCase() };
}

export type AccessTokenVerifier = (token: string) => Promise<AuthUser | null>;

/**
 * Verifies a Supabase access token (signature + expiry; asymmetric keys are
 * checked locally against the JWKS, legacy secrets via the Auth server).
 */
const supabaseVerifier: AccessTokenVerifier = async (token) => {
  const { data, error } = await createSupabaseAnonClient().auth.getClaims(token);
  if (error || !data?.claims) return null;
  return authUserFromClaims(data.claims);
};

let verifier: AccessTokenVerifier = supabaseVerifier;

/** Test hook: replaces token verification (never used in production code). */
export function setAccessTokenVerifierForTests(v: AccessTokenVerifier | null) {
  verifier = v ?? supabaseVerifier;
}

export function verifyAccessToken(token: string): Promise<AuthUser | null> {
  return verifier(token);
}
