import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and sends visitors
 * without a session to /login. This is only a convenience redirect: actual
 * authorization (membership + role) happens in the server data layer.
 */
const PUBLIC_PATHS = ["/login", "/auth/", "/api/cron/"];

/** Paths with their own authentication (bearer token) or none at all: no cookie session work. */
const SKIP_PATHS = ["/api/v1/", "/api/apple-app-site-association", "/.well-known/"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // E-mail links whose redirect target was not allow-listed in Supabase fall
  // back to the Site URL; keep them working by routing them to the confirm step.
  if (searchParams.has("token_hash") && !pathname.startsWith("/auth/")) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/confirm";
    return NextResponse.redirect(target);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new NextResponse(
      "Supabase ist nicht konfiguriert. Siehe README (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  // Do not run code between createServerClient and getClaims (session refresh).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  if (!signedIn && !isPublic) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const redirect = NextResponse.redirect(target);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
