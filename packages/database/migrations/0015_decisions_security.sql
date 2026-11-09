-- Decisions & experiments: same access model as ideas (0009_todos_ideas_crm_security.sql).
--   * Writes only through the server (services check the active membership,
--     the status rules and the required completion fields).
--   * The Data API role `authenticated` may only SELECT, filtered by RLS:
--     active members of the workspace. anon: no access.
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decision_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decision_relations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decision_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.decisions, public.decision_links, public.decision_relations, public.decision_history
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.decisions, public.decision_links, public.decision_relations, public.decision_history
  TO authenticated;
--> statement-breakpoint
CREATE POLICY decisions_select_member ON public.decisions
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY decision_links_select_member ON public.decision_links
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY decision_relations_select_member ON public.decision_relations
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY decision_history_select_member ON public.decision_history
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint

-- The history is a record of what happened: entries can neither be edited
-- nor deleted on their own — only together with their decision
-- (ON DELETE CASCADE; the parent row is already gone at that point).
CREATE OR REPLACE FUNCTION public.decision_history_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM public.decisions d WHERE d.id = OLD.decision_id) THEN
    RAISE EXCEPTION 'decision history entry % cannot be changed', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'decision_history_immutable';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decision_history_protect
  BEFORE UPDATE OR DELETE ON public.decision_history
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_protect();
