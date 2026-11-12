"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { authorizeRealtime, getBrowserSupabase } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { instantToWallTime } from "@vistoo/domain/meetings";

// ---------------------------------------------------------------------------
// Current time (hydration-safe, ticks every 30 s)
// ---------------------------------------------------------------------------

let nowMs = 0;
function subscribeNow(onChange: () => void) {
  const timer = setInterval(() => {
    nowMs = Date.now();
    onChange();
  }, 30_000);
  return () => clearInterval(timer);
}

/**
 * Current time on the client; during SSR/hydration the server's render time
 * (`serverNow`), so upcoming/past sections render identically on both sides.
 */
export function useNow(serverNow: string): Date {
  const ms = useSyncExternalStore(
    subscribeNow,
    () => nowMs || (nowMs = Date.now()),
    () => new Date(serverNow).getTime(),
  );
  return new Date(ms);
}

// ---------------------------------------------------------------------------
// Visual building blocks
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Small calendar tile (month above day), in the team's time zone. */
export function DateTile({ iso, muted, className }: { iso: string; muted?: boolean; className?: string }) {
  const { date } = instantToWallTime(iso);
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const day = Number(date.slice(8, 10));
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 flex-col items-center justify-center rounded-xl border bg-background leading-none",
        className,
      )}
    >
      <span className={cn("text-[10px] font-semibold tracking-wide uppercase", muted ? "text-muted-foreground" : "text-accent-blue-text")}>
        {month}
      </span>
      <span className={cn("mt-0.5 text-[17px] font-semibold tabular-nums", muted && "text-muted-foreground")}>{day}</span>
    </span>
  );
}

/** Overlapping initials avatars ("+3" for the rest); the full names are in the label. */
export function AvatarStack({
  ids,
  people,
  max = 4,
  size = "sm",
  className,
}: {
  ids: string[];
  people: Map<string, MemberDTO>;
  max?: number;
  size?: "xs" | "sm";
  className?: string;
}) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  const names = ids.map((id) => {
    const m = people.get(id);
    return m ? displayName(m) : "Ehemaliges Mitglied";
  });
  return (
    <span role="img" aria-label={`Teilnehmende: ${names.join(", ")}`} title={names.join(", ")} className={cn("flex items-center", className)}>
      {shown.map((id) => (
        <MemberAvatar
          key={id}
          member={people.get(id) ?? { fullName: "?", email: "?" }}
          size={size}
          className="-ml-1 ring-2 ring-background first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "-ml-1 inline-flex items-center justify-center rounded-full bg-surface-subtle font-medium text-muted-foreground ring-2 ring-background",
            size === "xs" ? "size-5 text-[9px]" : "size-6 text-[10px]",
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Realtime: change signal for meeting tables
// ---------------------------------------------------------------------------

const MEETING_TABLES = ["meetings", "meeting_participants", "meeting_agenda_items", "meeting_agenda_relations"] as const;

/**
 * Calls `onChange` (debounced) when meeting data of the workspace changes,
 * after a reconnect, when the tab becomes visible again and when a restored
 * page becomes active again. Realtime is only
 * a signal: the caller reloads through the server. What is delivered is
 * decided by the RLS SELECT policies (active members only).
 */
export function useMeetingSignals(workspaceId: string, onChange: () => void, delayMs = 400) {
  const handler = useRef(onChange);
  const activated = useRef(false);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    let supabase: SupabaseClient;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handler.current(), delayMs);
    };
    const filter = `workspace_id=eq.${workspaceId}`;
    // Navigating back restores the page with its previous state (React
    // Activity): catch up on what changed while it was hidden.
    if (activated.current) fire();
    activated.current = true;

    void (async () => {
      if (!(await authorizeRealtime(supabase)) || cancelled) return;
      let ch = supabase.channel(`meetings:${workspaceId}:${Math.random().toString(36).slice(2)}`);
      for (const table of MEETING_TABLES) {
        ch = ch
          .on("postgres_changes", { event: "*", schema: "public", table, filter }, fire)
          // Delete events cannot be filtered server-side.
          .on("postgres_changes", { event: "DELETE", schema: "public", table }, fire);
      }
      let subscribedOnce = false;
      channel = ch.subscribe((status) => {
        if (status === "SUBSCRIBED" && (disconnected || !subscribedOnce)) {
          // First join: catch up on changes between rendering and subscribing. Rejoin: after a gap.
          subscribedOnce = true;
          disconnected = false;
          fire();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          disconnected = true;
        }
      });
    })();

    let hiddenSince = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenSince = Date.now();
      else if (hiddenSince && Date.now() - hiddenSince > 30_000) fire();
    };
    window.addEventListener("online", fire);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", fire);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [workspaceId, delayMs]);
}
