/**
 * One-time bootstrap of the first admin.
 *
 *   npm run bootstrap:admin -- admin@example.com
 *
 * - Creates the workspace "Vistoo" if it does not exist yet.
 * - Refuses to run once the workspace has an active admin (no hidden
 *   backdoor: later admins are invited through the UI).
 * - Creates an admin invitation bound to the given e-mail and sends the
 *   invitation e-mail through Supabase Auth. No passwords are involved.
 *
 * Requires DATABASE_URL (or DIRECT_DATABASE_URL), NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SECRET_KEY — i.e. it can only be run by someone who already
 * holds the project secrets.
 */
import { and, eq } from "drizzle-orm";
import { INVITATION_TTL_DAYS } from "@vistoo/domain";
import { adminSupabase, connect, siteUrl, WORKSPACE_SLUG, schema } from "./lib";

const { workspaces, workspaceMembers, workspaceInvitations } = schema;

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Verwendung: npm run bootstrap:admin -- admin@example.com");
    process.exit(1);
  }
  const { db, client } = connect();
  try {
    let [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, WORKSPACE_SLUG));
    if (!ws) {
      [ws] = await db.insert(workspaces).values({ name: "Vistoo", slug: WORKSPACE_SLUG }).returning();
      console.log("✓ Workspace „Vistoo“ angelegt");
    }

    const admins = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.role, "admin"),
          eq(workspaceMembers.status, "active"),
        ),
      );
    if (admins.length > 0) {
      console.error("✗ Es gibt bereits einen aktiven Admin. Weitere Admins bitte über die Teamansicht einladen.");
      process.exit(1);
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
    const [pending] = await db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, ws.id),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, "pending"),
        ),
      );
    if (pending) {
      await db
        .update(workspaceInvitations)
        .set({ role: "admin", expiresAt, lastSentAt: new Date(), updatedAt: new Date() })
        .where(eq(workspaceInvitations.id, pending.id));
    } else {
      await db.insert(workspaceInvitations).values({ workspaceId: ws.id, email, role: "admin", expiresAt });
    }
    console.log(`✓ Admin-Einladung für ${email} gespeichert (gültig ${INVITATION_TTL_DAYS} Tage)`);

    const supabase = adminSupabase();
    const redirectTo = `${siteUrl()}/auth/confirm`;
    const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) {
      if (error.code === "email_exists" || error.status === 422) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
        });
        if (otpError) throw otpError;
      } else {
        throw error;
      }
    }
    console.log(`✓ E-Mail an ${email} versendet. Link öffnen → Namen eingeben → „Einladung annehmen“.`);
    console.log(`  Alternativ: ${siteUrl()}/login mit dieser Adresse aufrufen.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("✗ Bootstrap fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
