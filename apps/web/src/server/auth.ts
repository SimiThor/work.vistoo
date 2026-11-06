import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  accessRevoked,
  authUserFromClaims,
  resolveMembership,
  sessionExpired,
  type AuthContext,
  type AuthUser,
} from "@vistoo/backend/auth";
import { createSupabaseServerClient } from "./supabase";

/**
 * Next.js adapter: identity from the session cookie. Authorization itself
 * (membership + role) is the shared backend logic in @vistoo/backend/auth,
 * also used by the HTTP API for native clients.
 */

export type { AuthContext, AuthUser };
export { assertAdmin, resolveMembership } from "@vistoo/backend/auth";

/** Verifies the session JWT (signature + expiry). Deduplicated per request only. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  // Session validation depends on the current time: always request-time.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) return null;
  return authUserFromClaims(data?.claims);
});

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
  if (!user) throw sessionExpired();
  const ctx = await getAuthContextCached();
  if (!ctx) throw accessRevoked();
  return ctx;
}
