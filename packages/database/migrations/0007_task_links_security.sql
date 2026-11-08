-- Task links: same access model as tasks (see 0001_security.sql).
--   * Writes only through the server (services check the active membership and
--     that the task's project is not archived). No insert/update/delete policies.
--   * Active workspace members may SELECT, so Supabase Realtime can deliver
--     changes to them. Removed members see nothing.
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.task_links FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.task_links TO authenticated;
--> statement-breakpoint
CREATE POLICY task_links_select_member ON public.task_links
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_links;
  END IF;
END
$$;
