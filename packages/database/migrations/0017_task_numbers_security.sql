-- Issue numbers: assignment and protection.
--   * Every inserted task gets the next number of its workspace, whatever the
--     client sent. The counter row is upserted and incremented in the same
--     statement; ON CONFLICT DO UPDATE takes a row lock, so concurrent inserts
--     in one workspace queue up and each sees the previous increment
--     (READ COMMITTED re-reads the locked row). A rolled-back insert also rolls
--     back its increment, so no number is handed out twice and committed
--     numbers are never reused, even after the task is deleted.
--   * Numbers and the workspace of a task never change afterwards.
--   * The counter table is server-internal: no access for anon/authenticated.
ALTER TABLE public.task_number_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.task_number_counters FROM anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tasks_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task_number_counters AS c (workspace_id, last_number)
  VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_number = c.last_number + 1
  RETURNING c.last_number INTO NEW.number;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tasks_assign_number() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tasks_assign_number
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_assign_number();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tasks_protect_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Issue numbers cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tasks_protect_number() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tasks_protect_number
  BEFORE UPDATE OF number, workspace_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_protect_number();
