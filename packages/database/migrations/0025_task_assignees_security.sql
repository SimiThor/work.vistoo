-- Several assignees per task (tasks.assignee_ids), see 0024.
--   * assignee_id stays as the legacy single assignee (= assignee_ids[1]) for
--     API v1 clients. One trigger keeps both columns in sync in either
--     direction, so old SQL paths that only write assignee_id stay correct.
--   * Every assignee must be an ACTIVE member of the task's workspace
--     (replaces tasks_check_assignee_active from 0001, which only knew
--     assignee_id; arrays cannot carry foreign keys).
--   * When a membership stops being active, the person is removed from all
--     assignee lists (replaces the 0001 safety net).

-- Backfill: existing single assignments become one-element lists.
UPDATE public.tasks
   SET assignee_ids = ARRAY[assignee_id]
 WHERE assignee_id IS NOT NULL
   AND cardinality(assignee_ids) = 0;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tasks_check_assignee_active ON public.tasks;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.tasks_check_assignee_active();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tasks_assignees_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  missing uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.assignee_ids) = 0 AND NEW.assignee_id IS NOT NULL THEN
      NEW.assignee_ids := ARRAY[NEW.assignee_id];
    END IF;
  ELSIF NEW.assignee_ids IS DISTINCT FROM OLD.assignee_ids THEN
    NULL; -- the list is authoritative; assignee_id is derived below
  ELSIF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    -- Legacy write of the single assignee only: it replaces the list.
    NEW.assignee_ids := CASE WHEN NEW.assignee_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.assignee_id] END;
  END IF;

  -- Drop duplicates, keep the first occurrence (display order).
  SELECT coalesce(array_agg(u ORDER BY ord), '{}'::uuid[])
    INTO NEW.assignee_ids
    FROM (
      SELECT u, min(ord) AS ord
        FROM unnest(NEW.assignee_ids) WITH ORDINALITY AS a(u, ord)
       GROUP BY u
    ) d;
  NEW.assignee_id := NEW.assignee_ids[1];

  SELECT a.u INTO missing
    FROM unnest(NEW.assignee_ids) AS a(u)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = NEW.workspace_id
        AND m.user_id = a.u
        AND m.status = 'active'
   )
   LIMIT 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'assignee % is not an active member of workspace %', missing, NEW.workspace_id
      USING ERRCODE = '23514', CONSTRAINT = 'tasks_assignee_active';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_assignees_sync
  BEFORE INSERT OR UPDATE OF assignee_id, assignee_ids, workspace_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_assignees_sync();
--> statement-breakpoint

-- Safety net: when a membership stops being active, remove the person from
-- every assignee list. The service layer does this explicitly as well.
CREATE OR REPLACE FUNCTION public.workspace_members_unassign_on_remove()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE public.tasks
       SET assignee_ids = array_remove(assignee_ids, NEW.user_id),
           version = version + 1,
           updated_at = now()
     WHERE workspace_id = NEW.workspace_id
       AND assignee_ids @> ARRAY[NEW.user_id];
  END IF;
  RETURN NEW;
END;
$$;
