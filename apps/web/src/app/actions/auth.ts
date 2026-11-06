"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@vistoo/domain/result";
import { emailSchema } from "@vistoo/domain/validation";
import { toActionError } from "@/server/action";
import { getAuthUser } from "@/server/auth";
import { sessionExpired } from "@vistoo/backend/auth";
import { acceptInvitation } from "@vistoo/backend/services/invitations";
import { requestLoginCode } from "@vistoo/backend/services/login";
import { createSupabaseServerClient } from "@/server/supabase";

/** Sends a magic link + one-time code (shared rule: @vistoo/backend/services/login). */
export async function requestLoginAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = z.object({ email: emailSchema }).safeParse(input);
  if (!parsed.success) return toActionError(parsed.error);
  try {
    const supabase = await createSupabaseServerClient();
    return { ok: true, data: await requestLoginCode(supabase, parsed.data.email, "web") };
  } catch (err) {
    return toActionError(err);
  }
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
    if (!user) throw sessionExpired();
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
