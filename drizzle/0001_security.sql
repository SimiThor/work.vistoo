-- Security layer: RLS, helper functions, integrity triggers and realtime.
--
-- Access model
--   * The Next.js server talks to Postgres directly through Drizzle with a
--     privileged role. RLS does NOT apply there; authorization is enforced in
--     the server-side service layer (src/server/services).
--   * Browsers only talk to Supabase for Auth and Realtime. Through the
--     Supabase Data API they get SELECT-only access to rows of workspaces in
--     which they are an *active* member. No insert/update/delete policies exist,
--     so every write must go through the server.
--   * Supabase Realtime (postgres_changes) evaluates these SELECT policies per
--     subscriber, so removed members stop receiving events immediately.
--
-- Requires the Supabase roles `anon` and `authenticated` and the `auth.uid()`
-- function (both exist in every Supabase project).

-- ---------------------------------------------------------------------------
-- Helper: is the current JWT subject an active member of the workspace?
-- SECURITY DEFINER so the lookup itself is not subject to RLS recursion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_workspace_member(ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members m
    WHERE m.workspace_id = ws
      AND m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_active_workspace_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Integrity: a task assignee must be an ACTIVE member of the task workspace.
-- (Membership itself is guaranteed by the composite FK tasks_assignee_fk.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_check_assignee_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = NEW.workspace_id
      AND m.user_id = NEW.assignee_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'assignee % is not an active member of workspace %', NEW.assignee_id, NEW.workspace_id
      USING ERRCODE = '23514', CONSTRAINT = 'tasks_assignee_active';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_check_assignee_active
  BEFORE INSERT OR UPDATE OF assignee_id, workspace_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_check_assignee_active();
--> statement-breakpoint

-- Safety net: when a membership stops being active, clear its assignments.
-- The service layer does this explicitly as well; the trigger guarantees it.
CREATE OR REPLACE FUNCTION public.workspace_members_unassign_on_remove()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE public.tasks
       SET assignee_id = NULL,
           version = version + 1,
           updated_at = now()
     WHERE workspace_id = NEW.workspace_id
       AND assignee_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_members_unassign_on_remove
  AFTER UPDATE OF status ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.workspace_members_unassign_on_remove();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row Level Security on every application table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.project_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Least privilege for Data API roles: remove Supabase's default grants and
-- re-grant SELECT only where realtime needs it.
REVOKE ALL ON public.profiles, public.workspaces, public.workspace_members,
  public.workspace_invitations, public.projects, public.project_groups, public.tasks
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.workspaces, public.workspace_members, public.projects,
  public.project_groups, public.tasks
  TO authenticated;
--> statement-breakpoint

CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(id));
--> statement-breakpoint
CREATE POLICY workspace_members_select_member ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY projects_select_member ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY project_groups_select_member ON public.project_groups
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY tasks_select_member ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
-- profiles and workspace_invitations: RLS enabled, no policies, no grants
-- => not reachable through the Data API at all.

-- ---------------------------------------------------------------------------
-- Realtime: publish row changes of the tables the UI subscribes to.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.tasks, public.projects, public.project_groups, public.workspace_members;
  END IF;
END
$$;
