-- Least privilege for the Supabase Data API roles (found by tests/security.test.ts).
--
-- Supabase grants every new function and sequence in `public` DIRECTLY to anon
-- and authenticated, so the earlier `REVOKE ... FROM PUBLIC` did not remove
-- them for anon. Neither was exploitable (auth.uid() is NULL for anon, so the
-- helpers always return false; sequences are not exposed by the Data API),
-- but anon needs none of it.
--   * RLS helpers: only `authenticated` may execute them (policies run as the caller).
--   * Sequences: only the server (privileged connection) uses them.
REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member(uuid) FROM anon;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.can_access_conversation(uuid) FROM anon;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
