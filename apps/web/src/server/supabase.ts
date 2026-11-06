import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@vistoo/backend/supabase";

export { authRedirectUrl, getSiteUrl } from "@vistoo/backend/supabase";

/** Per-request Supabase client bound to the user's auth cookies. Never cache globally. */
export async function createSupabaseServerClient() {
  // Read the request first: marks the caller as dynamic before any config check.
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // Session refresh is handled by src/proxy.ts.
        }
      },
    },
  });
}
