/**
 * Shared helpers for CLI scripts (bootstrap, seed). Not imported by the app.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema";
import { databaseTlsOptions } from "../src/tls";

// Run via `npm run … -w @vistoo/database` (cwd = packages/database). Same env files as the web app.
config({ path: "../../apps/web/.env.local", quiet: true });
config({ path: "../../apps/web/.env", quiet: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} ist nicht gesetzt (siehe .env.example).`);
    process.exit(1);
  }
  return v;
}

export function connect() {
  const url = process.env.DIRECT_DATABASE_URL ?? requireEnv("DATABASE_URL");
  const client = postgres(url, { ...databaseTlsOptions(url), max: 1, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client, url };
}

export function adminSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SECRET_KEY ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "" || host === "::1";
  } catch {
    return false;
  }
}

export const WORKSPACE_SLUG = "vistoo";
export { schema };
