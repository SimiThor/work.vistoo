import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { STATE_FILE } from "./support";

/**
 * Creates an isolated workspace + first-admin invitation for this run, so
 * E2E tests never touch regular local development data.
 */
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  const dbUrl = process.env.DATABASE_URL ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/127\.0\.0\.1|localhost/.test(dbUrl) || !/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
    throw new Error("E2E tests only run against the local Supabase stack.");
  }
  const runId = Date.now().toString(36);
  const s = {
    runId,
    adminEmail: `admin-${runId}@e2e.vistoo.test`,
    memberEmail: `member-${runId}@e2e.vistoo.test`,
    strangerEmail: `stranger-${runId}@e2e.vistoo.test`,
  };

  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-" + runId}) returning id`;
  await sql`insert into workspace_invitations (workspace_id, email, role, expires_at)
            values (${ws.id}, ${s.adminEmail}, 'admin', now() + interval '7 days')`;
  await sql.end();

  const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(s.adminEmail, {
    redirectTo: "http://localhost:3100/auth/confirm",
  });
  if (error) throw error;
  // A confirmed auth user WITHOUT any invitation (must not get access).
  const { error: e2 } = await admin.auth.admin.createUser({ email: s.strangerEmail, email_confirm: true });
  if (e2) throw e2;

  writeFileSync(STATE_FILE, JSON.stringify(s));
}
