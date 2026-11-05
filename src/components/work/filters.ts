"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { TASK_STATUSES, type TaskDTO, type TaskStatus } from "@/lib/domain";

/**
 * View + filter state lives in the URL (shareable, back/forward works).
 * Updated via the History API, which Next.js syncs with useSearchParams
 * without a server round-trip.
 *
 * Semantics: values within one filter are OR-ed, different filters AND-ed.
 */

export type View = "board" | "timeline";
export type Scale = "day" | "week";
export const UNASSIGNED = "none";
export const NO_GROUP = "none";

export type Filters = {
  q: string;
  projects: string[];
  groups: string[]; // group ids or NO_GROUP
  assignees: string[]; // user ids or UNASSIGNED
  statuses: TaskStatus[];
};

export type WorkUrlState = Filters & {
  view: View;
  scale: Scale;
  task: string | null; // task id, "new" or null
  newStatus: TaskStatus | null;
};

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function parseWorkUrl(params: URLSearchParams): WorkUrlState {
  const statuses = list(params.get("status")).filter((s): s is TaskStatus =>
    (TASK_STATUSES as readonly string[]).includes(s),
  );
  const ns = params.get("newStatus");
  return {
    view: params.get("view") === "timeline" ? "timeline" : "board",
    scale: params.get("scale") === "week" ? "week" : "day",
    q: params.get("q") ?? "",
    projects: list(params.get("project")),
    groups: list(params.get("group")),
    assignees: list(params.get("assignee")),
    statuses,
    task: params.get("task"),
    newStatus: ns && (TASK_STATUSES as readonly string[]).includes(ns) ? (ns as TaskStatus) : null,
  };
}

const KEY: Record<keyof WorkUrlState, string> = {
  view: "view",
  scale: "scale",
  q: "q",
  projects: "project",
  groups: "group",
  assignees: "assignee",
  statuses: "status",
  task: "task",
  newStatus: "newStatus",
};

const DEFAULTS: Partial<Record<keyof WorkUrlState, string>> = { view: "board", scale: "day" };

export function buildSearch(current: URLSearchParams, patch: Partial<WorkUrlState>): string {
  const next = new URLSearchParams(current);
  for (const [k, value] of Object.entries(patch) as [keyof WorkUrlState, unknown][]) {
    const key = KEY[k];
    const str = Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
    if (!str || DEFAULTS[k] === str) next.delete(key);
    else next.set(key, str);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.q.trim() || f.projects.length || f.groups.length || f.assignees.length || f.statuses.length);
}

export function applyFilters(tasks: TaskDTO[], f: Filters): TaskDTO[] {
  const q = f.q.trim().toLocaleLowerCase("de");
  return tasks.filter((t) => {
    if (q && !t.title.toLocaleLowerCase("de").includes(q)) return false;
    if (f.projects.length && !f.projects.includes(t.projectId)) return false;
    if (f.groups.length && !f.groups.includes(t.groupId ?? NO_GROUP)) return false;
    if (f.assignees.length && !f.assignees.includes(t.assigneeId ?? UNASSIGNED)) return false;
    if (f.statuses.length && !f.statuses.includes(t.status)) return false;
    return true;
  });
}

export function useWorkUrl() {
  const params = useSearchParams();
  const state = useMemo(() => parseWorkUrl(new URLSearchParams(params.toString())), [params]);

  /** push = new history entry (filters, view, panel); replace = typing in search. */
  const update = useCallback((patch: Partial<WorkUrlState>, mode: "push" | "replace" = "push") => {
    const search = buildSearch(new URLSearchParams(window.location.search), patch);
    const url = `${window.location.pathname}${search}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  return { state, update };
}
