import type { TaskStatus } from "./constants";

/**
 * Task filter semantics shared by all clients (web filters in the URL, iOS
 * filter sheet). Values within one filter are OR-ed, different filters AND-ed.
 * Search matches the title, case-insensitively (German locale).
 *
 * Conformance cases: packages/contracts/fixtures/task-filters.json — run by
 * the TypeScript tests AND the Swift tests, so both platforms filter alike.
 */

export const UNASSIGNED = "none";
export const NO_GROUP = "none";

export type Filters = {
  q: string;
  projects: string[];
  groups: string[]; // group ids or NO_GROUP
  assignees: string[]; // user ids or UNASSIGNED
  statuses: TaskStatus[];
};

export const EMPTY_FILTERS: Filters = { q: "", projects: [], groups: [], assignees: [], statuses: [] };

type FilterableTask = {
  title: string;
  projectId: string;
  groupId: string | null;
  assigneeId: string | null;
  status: TaskStatus;
};

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.q.trim() || f.projects.length || f.groups.length || f.assignees.length || f.statuses.length);
}

export function matchesFilters(t: FilterableTask, f: Filters): boolean {
  const q = f.q.trim().toLocaleLowerCase("de");
  if (q && !t.title.toLocaleLowerCase("de").includes(q)) return false;
  if (f.projects.length && !f.projects.includes(t.projectId)) return false;
  if (f.groups.length && !f.groups.includes(t.groupId ?? NO_GROUP)) return false;
  if (f.assignees.length && !f.assignees.includes(t.assigneeId ?? UNASSIGNED)) return false;
  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  return true;
}

export function applyFilters<T extends FilterableTask>(tasks: T[], f: Filters): T[] {
  return tasks.filter((t) => matchesFilters(t, f));
}
