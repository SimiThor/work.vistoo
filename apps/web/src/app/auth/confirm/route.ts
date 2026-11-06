import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/server/supabase";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "invite", "signup", "recovery", "email_change"];

/**
 * Target of magic-link and invitation e-mails.
 *  - `token_hash` + `type` (recommended templates, works across browsers)
 *  - `code` (PKCE, same browser only)
 * Without either, the browser is sent to /login, which also understands the
 * implicit-flow URL fragment of Supabase's default templates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const home = new URL("/tasks", request.url);
  const failed = new URL("/login?error=link", request.url);

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    return NextResponse.redirect(error ? failed : home);
  }
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(error ? failed : home);
  }
  // Fragment (#access_token=…) is preserved by the browser across this redirect.
  return NextResponse.redirect(new URL("/login?from=link", request.url));
}
