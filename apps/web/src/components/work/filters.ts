"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { TASK_STATUSES, type TaskStatus } from "@vistoo/domain";
import type { Filters } from "@vistoo/domain/filters";

export {
  applyFilters,
  hasActiveFilters,
  NO_MILESTONE,
  UNASSIGNED,
  type Filters,
} from "@vistoo/domain/filters";

/**
 * View + filter state lives in the URL (shareable, back/forward works).
 * Updated via the History API, which Next.js syncs with useSearchParams
 * without a server round-trip.
 *
 * Semantics: values within one filter are OR-ed, different filters AND-ed.
 * The web offers search, project, milestone and person filters. The status
 * filter (still part of the shared semantics, used by iOS) is not read from
 * the URL, so old links cannot hide tasks invisibly. Old `group=` parameters
 * (groups were removed) are ignored.
 */

export type View = "board" | "timeline";
export type Scale = "day" | "week";
export type WorkUrlState = Filters & {
  milestones: string[];
  view: View;
  scale: Scale;
  task: string | null; // task id, "new" or null
  newStatus: TaskStatus | null;
};

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function parseWorkUrl(params: URLSearchParams): WorkUrlState {
  const ns = params.get("newStatus");
  return {
    view: params.get("view") === "timeline" ? "timeline" : "board",
    scale: params.get("scale") === "week" ? "week" : "day",
    q: params.get("q") ?? "",
    projects: list(params.get("project")),
    milestones: list(params.get("milestone")),
    assignees: list(params.get("assignee")),
    statuses: [],
    task: params.get("task"),
    newStatus: ns && (TASK_STATUSES as readonly string[]).includes(ns) ? (ns as TaskStatus) : null,
  };
}

const KEY: Record<keyof WorkUrlState, string> = {
  view: "view",
  scale: "scale",
  q: "q",
  projects: "project",
  milestones: "milestone",
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
