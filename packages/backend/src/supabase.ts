import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase configuration of the environment this server runs in. Web and iOS
 * receive the public part (URL + publishable key) from the same server, so
 * both clients always talk to the same Supabase project.
 */
export function getSupabaseConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see README).",
    );
  }
  return { url, publishableKey };
}

/**
 * Privileged client (service role / secret key). Only for the few admin
 * operations that require it: invitation e-mails and the private chat bucket.
 * Never exposed to any client.
 */
export function createSupabaseAdminClient() {
  const { url } = getSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set (required to send invitations).");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Stateless anon client (magic links on behalf of the server, token verification). */
export function createSupabaseAnonClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });
}

export function getSiteUrl(): string {
  const explicit = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL && process.env.VERCEL_ENV === "production") {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3100";
}

/** Where e-mail links send the user, per client platform. */
export type AuthLinkTarget = "web" | "ios";

/**
 * Web: /auth/confirm (sets the cookie session).
 * iOS: /auth/ios/confirm — a Universal Link path claimed by the app. Without
 * the app (or without Universal Links configured) the web page explains how
 * to continue with the one-time code.
 */
export function authRedirectUrl(target: AuthLinkTarget = "web"): string {
  return `${getSiteUrl()}${target === "ios" ? "/auth/ios/confirm" : "/auth/confirm"}`;
}
