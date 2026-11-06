"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/result";
import { emailSchema } from "@/lib/validation";
import { toActionError } from "@/server/action";
import { getAuthUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { sendInvitationEmail } from "@/server/mailer";
import { acceptInvitation, hasValidPendingInvitation } from "@/server/services/invitations";
import { createSupabaseServerClient, getSiteUrl } from "@/server/supabase";

/**
 * Sends a magic link + one-time code. Public sign-up is impossible:
 * `shouldCreateUser: false`, and access additionally requires an accepted
 * invitation. The response is identical whether or not the address is known.
 */
export async function requestLoginAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = z.object({ email: emailSchema }).safeParse(input);
  if (!parsed.success) return toActionError(parsed.error);
  const { email } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${getSiteUrl()}/auth/confirm` },
  });
  if (error && error.status === 429) {
    return {
      ok: false,
      error: { code: "VALIDATION", message: "Zu viele Versuche. Bitte warte kurz und versuche es erneut." },
    };
  }
  // Invited but never confirmed: with sign-ups disabled, Supabase refuses the
  // magic link. If a valid invitation exists, re-send the invitation e-mail
  // instead (its link confirms the account).
  if (error && (error.code === "signup_disabled" || error.code === "otp_disabled")) {
    try {
      if (await hasValidPendingInvitation(email)) await sendInvitationEmail(email);
    } catch (err) {
      console.error("[login] invitation resend failed:", err instanceof Error ? err.message : String(err));
    }
  }
  // Unknown addresses produce an error from Supabase; we deliberately do not reveal it.
  return { ok: true, data: { email } };
}

export async function verifyLoginCodeAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = z
    .object({
      email: emailSchema,
      code: z
        .string()
        .trim()
        .regex(/^\d{6,10}$/, { error: "Bitte gib den Code aus der E-Mail ein." }),
    })
    .safeParse(input);
  if (!parsed.success) return toActionError(parsed.error);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  });
  if (error) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Der Code ist ungültig oder abgelaufen.",
        fieldErrors: { code: "Der Code ist ungültig oder abgelaufen." },
      },
    };
  }
  redirect("/tasks");
}

export async function acceptInvitationAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = z
    .object({
      invitationId: z.uuid(),
      fullName: z
        .string()
        .trim()
        .min(1, { error: "Bitte gib deinen Namen ein." })
        .max(80, { error: "Der Name darf höchstens 80 Zeichen lang sein." }),
    })
    .safeParse(input);
  if (!parsed.success) return toActionError(parsed.error);
  try {
    const user = await getAuthUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
    await acceptInvitation(user, parsed.data);
  } catch (err) {
    return toActionError(err);
  }
  redirect("/tasks");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
