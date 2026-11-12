import type { TaskStatus } from "./constants";

/**
 * Task filter semantics shared by all clients (web filters in the URL, iOS
 * filter sheet). Values within one filter are OR-ed, different filters AND-ed.
 * The assignee filter matches a task if any of its assignees is selected.
 * Search matches the title, case-insensitively (German locale). A query that
 * is an issue number (`24` or `#24`) also matches the task with that number.
 *
 * Conformance cases: packages/contracts/fixtures/task-filters.json — run by
 * the TypeScript tests AND the Swift tests, so both platforms filter alike.
 */

export const UNASSIGNED = "none";
export const NO_MILESTONE = "none";

export type Filters = {
  q: string;
  projects: string[];
  assignees: string[]; // user ids or UNASSIGNED
  statuses: TaskStatus[];
  /** milestone ids or NO_MILESTONE. Optional: clients without milestones omit it. */
  milestones?: string[];
};

export const EMPTY_FILTERS: Filters = { q: "", projects: [], assignees: [], statuses: [], milestones: [] };

type FilterableTask = {
  title: string;
  /** Issue number (`#24`). Optional: callers without numbers only search titles. */
  number?: number;
  projectId: string;
  milestoneId?: string | null;
  assigneeId: string | null;
  /** All assignees. Optional: callers that only know one assignee omit it (then `assigneeId` counts). */
  assigneeIds?: string[];
  status: TaskStatus;
};

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.q.trim() || f.projects.length || f.assignees.length || f.statuses.length || f.milestones?.length);
}

export function matchesFilters(t: FilterableTask, f: Filters): boolean {
  const q = f.q.trim().toLocaleLowerCase("de");
  if (q && !t.title.toLocaleLowerCase("de").includes(q) && !matchesIssueNumber(t.number, q)) return false;
  if (f.projects.length && !f.projects.includes(t.projectId)) return false;
  if (f.assignees.length && !taskAssignees(t).some((a) => f.assignees.includes(a))) return false;
  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.milestones?.length && !f.milestones.includes(t.milestoneId ?? NO_MILESTONE)) return false;
  return true;
}

/** Assignee filter keys of a task: its user ids, or [UNASSIGNED]. A task matches if ANY assignee is selected. */
function taskAssignees(t: FilterableTask): string[] {
  const ids = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
  return ids.length ? ids : [UNASSIGNED];
}

/** `24` or `#24` (surrounding whitespace already trimmed) names issue #24. */
function matchesIssueNumber(number: number | undefined, q: string): boolean {
  const m = /^#?(\d{1,9})$/.exec(q);
  return number !== undefined && m !== null && Number(m[1]) === number;
}

export function applyFilters<T extends FilterableTask>(tasks: T[], f: Filters): T[] {
  return tasks.filter((t) => matchesFilters(t, f));
}
