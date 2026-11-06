-- Push notifications: device tokens and preferences are server-only.
-- RLS on, all Data-API grants revoked, no policies => unreachable for browsers/apps.
-- (Supabase grants new public tables to anon/authenticated by default.)
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.push_devices, public.notification_preferences FROM anon, authenticated;
