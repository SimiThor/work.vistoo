"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "./env";

let client: SupabaseClient | null = null;

/** One browser client per tab → one shared Realtime websocket for all channels. */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    const { url, key } = getPublicSupabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}

/**
 * Realtime must join with the user's JWT (not the anonymous key), otherwise
 * RLS rejects the subscription. Returns false when there is no session.
 */
export async function authorizeRealtime(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  await supabase.realtime.setAuth(data.session.access_token);
  return true;
}
