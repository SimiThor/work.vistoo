-- Milestones: same access model as projects (0001_security.sql).
--   * Writes only through the server (services check the active membership).
--   * Active workspace members may SELECT, so Supabase Realtime can deliver
--     changes to them. Removed members and anon see nothing.
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.milestones FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.milestones TO authenticated;
--> statement-breakpoint
CREATE POLICY milestones_select_member ON public.milestones
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.milestones;
  END IF;
END
$$;
