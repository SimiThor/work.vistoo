import "server-only";
import { createSupabaseAdminClient, createSupabaseAnonClient, getSiteUrl } from "./supabase";

/**
 * Sends the invitation e-mail through Supabase Auth.
 *
 * - New address: `auth.admin.inviteUserByEmail` creates the auth user and
 *   sends the "Invite user" template (works with public sign-ups disabled).
 * - Address already known to Supabase Auth (e.g. a re-invited former member):
 *   sends a normal magic link instead.
 *
 * Workspace access is granted only after the user accepts the invitation row
 * stored in our database; the e-mail itself grants nothing.
 */
export async function sendInvitationEmail(email: string): Promise<void> {
  const redirectTo = `${getSiteUrl()}/auth/confirm`;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return;

  const alreadyRegistered =
    error.code === "email_exists" || error.status === 422 || /already been registered/i.test(error.message);
  if (!alreadyRegistered) {
    throw new Error(`Invitation e-mail could not be sent (${error.code ?? error.status ?? "unknown"}).`);
  }

  const anon = createSupabaseAnonClient();
  const { error: otpError } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (otpError) {
    throw new Error(`Invitation e-mail could not be sent (${otpError.code ?? otpError.status ?? "unknown"}).`);
  }
}
