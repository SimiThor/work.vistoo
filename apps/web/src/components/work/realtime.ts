"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { TaskDTO, TaskStatus } from "@vistoo/domain";
import { authorizeRealtime, getBrowserSupabase } from "@/lib/supabase-browser";

type TaskRow = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  /** Missing in events from before migration 0024 (never in practice). */
  assignee_ids?: string[] | null;
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
    groupId: null, // groups were removed
    milestoneId: r.milestone_id ?? null,
    number: r.number,
    title: r.title,
    description: r.description,
    status: r.status,
    assigneeId: r.assignee_ids?.[0] ?? r.assignee_id ?? null,
    assigneeIds: r.assignee_ids ?? (r.assignee_id ? [r.assignee_id] : []),
    startDate: r.start_date,
    endDate: r.end_date,
    position: Number(r.position),
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    version: r.version,
  };
}

/** Window event fired when task links change elsewhere (open task panels reload their links). */
export const TASK_LINKS_CHANGED_EVENT = "vistoo:task-links-changed";
/** Deletes only carry the link id (no task id). */
export type TaskLinksChangedDetail = { taskId: string | null; linkId: string | null };

function emitTaskLinksChanged(detail: TaskLinksChangedDetail) {
  window.dispatchEvent(new CustomEvent<TaskLinksChangedDetail>(TASK_LINKS_CHANGED_EVENT, { detail }));
}

/**
 * Subscribes to row changes of the workspace. Access control is enforced by
 * RLS on the server side of Supabase Realtime (SELECT policies for active
 * members); the `workspace_id` filter only narrows the stream.
 *
 * - tasks: merged into the local store by version (no duplicates with
 *   optimistic updates or server responses).
 * - task links: announced as a window event for the open task panel.
 * - projects / milestones / members: trigger a router refresh (debounced).
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
      if (!(await authorizeRealtime(supabase)) || cancelled) return;

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
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "task_links", filter },
          (payload: RealtimePostgresChangesPayload<{ id: string; task_id: string }>) => {
            const row = payload.eventType === "DELETE" ? payload.old : payload.new;
            emitTaskLinksChanged({ taskId: row.task_id ?? null, linkId: row.id ?? null });
          },
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_links" }, (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) emitTaskLinksChanged({ taskId: null, linkId: id });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "milestones", filter }, refreshSoon)
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
