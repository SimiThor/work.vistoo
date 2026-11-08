-- Personal to-dos, ideas and CRM: same access model as tasks (0001_security.sql).
--   * Writes only through the server (services check the active membership,
--     ownership of to-dos and immutability of system activities).
--   * The Data API role `authenticated` may only SELECT, filtered by RLS:
--       personal_todos            → only the owner (and only while an active member),
--       ideas, attractions,
--       attraction_activities     → active members of the workspace.
--   * anon: no access.
ALTER TABLE public.personal_todos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.attractions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.attraction_activities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.personal_todos, public.ideas, public.attractions, public.attraction_activities
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.personal_todos, public.ideas, public.attractions, public.attraction_activities
  TO authenticated;
--> statement-breakpoint
CREATE POLICY personal_todos_select_owner ON public.personal_todos
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY ideas_select_member ON public.ideas
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY attractions_select_member ON public.attractions
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY attraction_activities_select_member ON public.attraction_activities
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint

-- Automatic timeline entries are a record of what happened: they can neither
-- be edited nor deleted on their own — only together with their attraction
-- (ON DELETE CASCADE; the parent row is already gone at that point).
CREATE OR REPLACE FUNCTION public.attraction_activities_protect_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.type IN ('created', 'status_changed', 'owner_changed', 'follow_up_changed') THEN
    IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM public.attractions a WHERE a.id = OLD.attraction_id) THEN
      RAISE EXCEPTION 'automatic activity % cannot be changed', OLD.id
        USING ERRCODE = '23514', CONSTRAINT = 'attraction_activities_system_immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attraction_activities_protect_system
  BEFORE UPDATE OR DELETE ON public.attraction_activities
  FOR EACH ROW EXECUTE FUNCTION public.attraction_activities_protect_system();
