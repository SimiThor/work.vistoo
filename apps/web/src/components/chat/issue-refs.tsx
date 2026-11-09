"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { STATUS_LABEL, type IssueRefDTO, type TaskStatus } from "@vistoo/domain";
import { formatIssueNumber, MISSING_ISSUE_LABEL } from "@vistoo/domain/issue-refs";
import { resolveIssueRefsAction } from "@/app/actions/issue-refs";
import { StatusIcon } from "@/components/status-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * Client cache of referenced tasks (`<#task-id>` in chat markup). The server
 * resolves references per reader (MessageDTO.issueRefs, picker results);
 * those prime the cache. Ids the client has not seen (realtime messages,
 * restored drafts) are fetched in small batches. "missing" = deleted or not
 * visible; such references render as plain text, never as a link.
 */

type Entry = IssueRefDTO | "missing";
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
const inFlight = new Set<string>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

export function primeIssueRefs(refs: readonly IssueRefDTO[]) {
  let changed = false;
  for (const r of refs) {
    const prev = cache.get(r.id);
    if (prev === "missing" || !prev || prev.number !== r.number || prev.title !== r.title || prev.status !== r.status) {
      cache.set(r.id, r);
      changed = true;
    }
  }
  if (changed) emit();
}

export function issueRefNumber(id: string): number | null {
  const e = cache.get(id);
  return e && e !== "missing" ? e.number : null;
}

let flushScheduled = false;
function flush() {
  flushScheduled = false;
  const ids = [...queued].slice(0, 50);
  for (const id of ids) {
    queued.delete(id);
    inFlight.add(id);
  }
  if (queued.size) schedule();
  if (!ids.length) return;
  void resolveIssueRefsAction({ ids }).then((res) => {
    for (const id of ids) inFlight.delete(id);
    if (!res.ok) return; // keep unknown; a later render retries
    const found = new Set(res.data.map((r) => r.id));
    for (const id of ids) if (!found.has(id)) cache.set(id, "missing");
    primeIssueRefs(res.data);
    emit();
  });
}
function schedule() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 0);
}

/** Requests display data for ids the cache does not know yet. */
export function requestIssueRefs(ids: readonly string[]) {
  for (const id of ids) {
    if (cache.has(id) || inFlight.has(id)) continue;
    queued.add(id);
  }
  if (queued.size) schedule();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders when the cache changes; returns a counter usable as a dependency. */
export function useIssueRefsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/** Cached entry for one id (fetching it if unknown). `undefined` while loading. */
export function useIssueRef(id: string): Entry | undefined {
  useIssueRefsVersion();
  useEffect(() => requestIssueRefs([id]), [id]);
  return cache.get(id);
}

export const issueHref = (taskId: string) => `/tasks?task=${encodeURIComponent(taskId)}`;

/**
 * `#24` inside a message: a quiet link to the task (opens the task panel via
 * the existing deep link). Hover shows number, title and status. Deleted or
 * inaccessible tasks render as muted text without a link.
 */
export function IssueRefLink({ taskId, fallback }: { taskId: string; fallback?: IssueRefDTO }) {
  const cached = useIssueRef(taskId);
  // The message's own resolution is authoritative for this render; the cache
  // fills in for realtime messages that arrived without it.
  const entry = fallback ?? cached;

  if (entry === undefined) {
    return <span className="text-muted-foreground tabular-nums">#…</span>;
  }
  if (entry === "missing") {
    return (
      <span data-issue-ref={taskId} className="text-muted-foreground line-through decoration-muted-foreground/40">
        {MISSING_ISSUE_LABEL}
      </span>
    );
  }
  const label = formatIssueNumber(entry.number);
  const status = entry.status as TaskStatus;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={issueHref(entry.id)}
          data-issue-ref={entry.id}
          aria-label={`${label} ${entry.title} öffnen`}
          className="rounded-[4px] font-medium text-accent-blue-text tabular-nums underline decoration-accent-blue/30 underline-offset-2 outline-none hover:decoration-accent-blue focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {label}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusIcon status={status} className="text-background" />
          <span className="tabular-nums opacity-70">{label}</span>
          <span className="truncate">{entry.title}</span>
        </span>
        <span className="sr-only">, Status {STATUS_LABEL[status] ?? entry.status}</span>
      </TooltipContent>
    </Tooltip>
  );
}
