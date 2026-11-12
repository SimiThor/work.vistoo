-- Meetings & agenda: same access model as decisions (0015_decisions_security.sql).
--   * Writes only through the server (services check the active membership,
--     time range, participants, agenda order and version conflicts).
--   * The Data API role `authenticated` may only SELECT, filtered by RLS:
--     active members of the workspace. anon: no access.
--   * The tables are part of the Realtime publication: open agendas reload
--     when someone else changes them (Realtime is only a change signal).
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.meeting_agenda_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.meeting_agenda_relations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.meetings, public.meeting_participants, public.meeting_agenda_items, public.meeting_agenda_relations
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.meetings, public.meeting_participants, public.meeting_agenda_items, public.meeting_agenda_relations
  TO authenticated;
--> statement-breakpoint
CREATE POLICY meetings_select_member ON public.meetings
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY meeting_participants_select_member ON public.meeting_participants
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY meeting_agenda_items_select_member ON public.meeting_agenda_items
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY meeting_agenda_relations_select_member ON public.meeting_agenda_relations
  FOR SELECT TO authenticated
  USING (public.is_active_workspace_member(workspace_id));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.meetings, public.meeting_participants, public.meeting_agenda_items, public.meeting_agenda_relations;
  END IF;
END
$$;
