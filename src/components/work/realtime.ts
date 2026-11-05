"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { TaskDTO, TaskStatus } from "@/lib/domain";
import { getPublicSupabaseEnv } from "@/lib/env";

let browserClient: SupabaseClient | null = null;
function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    const { url, key } = getPublicSupabaseEnv();
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}

type TaskRow = {
  id: string;
  project_id: string;
  group_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
};

function rowToTask(r: TaskRow): TaskDTO {
  return {
    id: r.id,
    projectId: r.project_id,
    groupId: r.group_id,
    title: r.title,
    description: r.description,
    status: r.status,
    assigneeId: r.assignee_id,
    startDate: r.start_date,
    endDate: r.end_date,
    position: Number(r.position),
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    version: r.version,
  };
}

/**
 * Subscribes to row changes of the workspace. Access control is enforced by
 * RLS on the server side of Supabase Realtime (SELECT policies for active
 * members); the `workspace_id` filter only narrows the stream.
 *
 * - tasks: merged into the local store by version (no duplicates with
 *   optimistic updates or server responses).
 * - projects / groups / members: trigger a router refresh (debounced).
 * - after a reconnect or when the tab becomes visible again: full resync.
 */
export function useRealtimeSync({
  workspaceId,
  onTask,
  onTaskDeleted,
  onResync,
}: {
  workspaceId: string;
  onTask: (t: TaskDTO) => void;
  onTaskDeleted: (id: string) => void;
  onResync: () => void;
}) {
  const router = useRouter();
  const handlers = useRef({ onTask, onTaskDeleted, onResync, router });
  useEffect(() => {
    handlers.current = { onTask, onTaskDeleted, onResync, router };
  });

  useEffect(() => {
    let supabase: SupabaseClient;
    try {
      supabase = getBrowserSupabase();
    } catch (err) {
      console.error("[realtime] Supabase client unavailable:", err);
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    const refreshSoon = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => handlers.current.router.refresh(), 300);
    };
    const filter = `workspace_id=eq.${workspaceId}`;

    void (async () => {
      // Join with the user's JWT, not the anonymous key: RLS decides what is delivered.
      // (Token refreshes are forwarded to realtime by supabase-js automatically.)
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channel = supabase
        .channel(`workspace:${workspaceId}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks", filter },
          (payload: RealtimePostgresChangesPayload<TaskRow>) => {
            if (payload.eventType === "DELETE") {
              const id = (payload.old as Partial<TaskRow>).id;
              if (id) handlers.current.onTaskDeleted(id);
            } else {
              handlers.current.onTask(rowToTask(payload.new));
            }
          },
        )
        // Delete events cannot be filtered server-side; they only carry the id.
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
          const id = (payload.old as Partial<TaskRow>).id;
          if (id) handlers.current.onTaskDeleted(id);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "project_groups", filter }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members", filter }, refreshSoon)
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            if (disconnected) {
              disconnected = false;
              handlers.current.onResync();
              refreshSoon();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            disconnected = true;
            if (err) console.warn("[realtime]", status, err.message);
          } else if (status === "CLOSED") {
            disconnected = true;
          }
        });
    })();

    let hiddenSince = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenSince = Date.now();
      else if (hiddenSince && Date.now() - hiddenSince > 30_000) handlers.current.onResync();
    };
    const onOnline = () => handlers.current.onResync();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [workspaceId]);
}
