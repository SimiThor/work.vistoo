import "server-only";
import { AppError } from "../errors";
import { sendInvitationEmail } from "../mailer";
import { authRedirectUrl, type AuthLinkTarget } from "../supabase";
import { hasValidPendingInvitation } from "./invitations";

/** Minimal slice of a Supabase auth client (cookie client on the web, stateless client for the API). */
export type OtpSender = {
  auth: {
    signInWithOtp(args: {
      email: string;
      options: { shouldCreateUser: boolean; emailRedirectTo: string };
    }): Promise<{ error: { status?: number; code?: string } | null }>;
  };
};

type Deps = { hasInvitation: (email: string) => Promise<boolean>; resendInvitation: typeof sendInvitationEmail };
const defaultDeps: Deps = { hasInvitation: hasValidPendingInvitation, resendInvitation: sendInvitationEmail };

/**
 * Sends a magic link + one-time code (same rule for web and iOS).
 *
 * - Public sign-up is impossible (`shouldCreateUser: false`); workspace access
 *   additionally requires an accepted invitation.
 * - Invited but never confirmed: Supabase refuses the magic link, so a valid
 *   pending invitation is re-sent instead (its link/code confirms the account).
 * - The result is identical whether or not the address is known.
 */
export async function requestLoginCode(
  supabase: OtpSender,
  email: string,
  target: AuthLinkTarget,
  deps: Deps = defaultDeps,
): Promise<{ email: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl(target) },
  });
  if (error && error.status === 429) {
    throw new AppError("RATE_LIMITED", "Zu viele Versuche. Bitte warte kurz und versuche es erneut.");
  }
  if (error && (error.code === "signup_disabled" || error.code === "otp_disabled")) {
    try {
      if (await deps.hasInvitation(email)) await deps.resendInvitation(email, target);
    } catch (err) {
      console.error("[login] invitation resend failed:", err instanceof Error ? err.message : String(err));
    }
  }
  // Unknown addresses produce an error from Supabase; we deliberately do not reveal it.
  return { email };
}
