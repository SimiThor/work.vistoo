-- In-app notifications (chat mentions): security layer.
--   * Writes only through the server (the chat service validates mentions
--     against the conversation's access rules before notifying).
--   * Recipients may SELECT their own rows while they can still access the
--     conversation, so Supabase Realtime can drive the unread badge.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.notifications FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.notifications TO authenticated;
--> statement-breakpoint
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_access_conversation(conversation_id));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;
