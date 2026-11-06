-- Chat security layer: access function, RLS, storage bucket, realtime, default channel.
--
-- Access model (mirrors src/server/services/chat.ts, which enforces the same
-- rules for the privileged Drizzle connection):
--   * only ACTIVE workspace members,
--   * open channels: every active member of the same workspace,
--   * private channels and DMs: explicit row in conversation_members,
--   * the admin role grants NO access to private conversations.
-- Browsers get SELECT only (needed for Realtime). All writes go through the server.

CREATE OR REPLACE FUNCTION public.can_access_conversation(conv uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.workspace_members wm
      ON wm.workspace_id = c.workspace_id
     AND wm.user_id = (SELECT auth.uid())
     AND wm.status = 'active'
    WHERE c.id = conv
      AND (
        c.kind = 'open_channel'
        OR EXISTS (
          SELECT 1 FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id AND cm.user_id = (SELECT auth.uid())
        )
      )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_access_conversation(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_access_conversation(uuid) TO authenticated;
--> statement-breakpoint

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.conversation_read_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON public.conversations, public.conversation_members, public.messages,
  public.message_attachments, public.conversation_read_states
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.conversations, public.conversation_members, public.messages,
  public.conversation_read_states
  TO authenticated;
--> statement-breakpoint

CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(id));
--> statement-breakpoint
CREATE POLICY conversation_members_select_participant ON public.conversation_members
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));
--> statement-breakpoint
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));
--> statement-breakpoint
CREATE POLICY conversation_read_states_select_own ON public.conversation_read_states
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_access_conversation(conversation_id));
--> statement-breakpoint
-- message_attachments: RLS on, no grants/policies => unreachable via the Data API.
-- Metadata is served by the server after its own access check.

-- Realtime: conversations (list/unread signal), memberships (newly added), messages (active view).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.conversations, public.conversation_members, public.messages;
  END IF;
END
$$;
--> statement-breakpoint

-- Private storage bucket for chat files. No storage.objects policies are
-- created: browsers cannot read or write directly. The server hands out
-- short-lived signed URLs after its own authorization checks.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'chat-files', 'chat-files', false, 10485760,
      ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ]
    )
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END
$$;
--> statement-breakpoint

-- Default open channel "Allgemein" for existing workspaces (idempotent; new
-- workspaces get it lazily from the service layer).
INSERT INTO public.conversations (workspace_id, kind, name, description, is_default)
SELECT w.id, 'open_channel', 'Allgemein', 'Für alle Themen, die das ganze Team betreffen.', true
FROM public.workspaces w
ON CONFLICT (workspace_id) WHERE is_default DO NOTHING;
