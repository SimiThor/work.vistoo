/**
 * Issue references in chat messages (`#24`): storage format and pure helpers
 * shared by server and clients. Works next to person mentions
 * (`<@user-uuid>`, see ./mentions) without touching them.
 *
 * Storage ("markup"): a reference is the token `<#task-uuid>` inside the
 * message body. The token carries only the stable task id; the number, title
 * and status are resolved at display time, so the link survives renames and
 * project moves. A reference to a task that was deleted (or is not visible to
 * the reader) stays in the text and renders as "deleted task".
 *
 * Plain text that merely looks like `#24` is NOT a reference; only tokens are.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const tokenRe = () => new RegExp(`<#(${UUID})>`, "gi");

export const issueRefToken = (taskId: string) => `<#${taskId.toLowerCase()}>`;

/** `#24` */
export const formatIssueNumber = (n: number) => `#${n}`;

/** Readable label for a reference whose task is gone or hidden. */
export const MISSING_ISSUE_LABEL = "#gelöschte Aufgabe";

/** Display data of a referenced task, resolved by the server for each reader. */
export type IssueRefInfo = { id: string; number: number; title: string; status: string; projectId: string };

export type IssueRefSegment = { type: "text"; text: string } | { type: "issue"; taskId: string };

/** Splits text into plain parts and issue references (in order). */
export function splitIssueRefs(markup: string): IssueRefSegment[] {
  const out: IssueRefSegment[] = [];
  let last = 0;
  for (const m of markup.matchAll(tokenRe())) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", text: markup.slice(last, start) });
    out.push({ type: "issue", taskId: m[1].toLowerCase() });
    last = start + m[0].length;
  }
  if (last < markup.length) out.push({ type: "text", text: markup.slice(last) });
  return out;
}

/** Distinct referenced task ids, in order of first appearance. */
export function extractIssueRefIds(markup: string): string[] {
  const ids = new Set<string>();
  for (const m of markup.matchAll(tokenRe())) ids.add(m[1].toLowerCase());
  return [...ids];
}

/**
 * Replaces every reference with `#24`, or `unknownLabel` when `numberOf` has
 * no number (default: the deleted label, right when the caller resolved all
 * ids). Other text, incl. `<@…>` tokens, is kept.
 */
export function renderIssueRefsPlain(
  markup: string,
  numberOf: (taskId: string) => number | null | undefined,
  unknownLabel = MISSING_ISSUE_LABEL,
): string {
  return markup.replace(tokenRe(), (_, id: string) => {
    const n = numberOf(id.toLowerCase());
    return n ? formatIssueNumber(n) : unknownLabel;
  });
}

// ---------------------------------------------------------------------------
// Search (the `#` picker)
// ---------------------------------------------------------------------------

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Relevance of a task for the text typed after `#` (higher is better, 0 = no
 * match). Digits match the number (exact before prefix: `2` → #2, #21, #245);
 * otherwise every word of the query must start a word of the title, or the
 * whole query must occur in the title.
 */
export function issueQueryScore(task: { number: number; title: string }, query: string): number {
  const q = fold(query.trim().replace(/^#/, ""));
  if (!q) return 1;
  if (/^\d+$/.test(q)) {
    const n = String(task.number);
    if (n === q) return 4;
    if (n.startsWith(q)) return 3;
  }
  const title = fold(task.title);
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.every((p) => words.some((w) => w.startsWith(p)))) return 2;
  if (title.includes(q)) return 1.5;
  return 0;
}

/**
 * Best matches first; ties by most recent number (newer issues are discussed
 * more often). Stable and deterministic for equal inputs.
 */
export function rankIssues<T extends { number: number; title: string }>(tasks: readonly T[], query: string, limit: number): T[] {
  return tasks
    .map((t) => ({ t, s: issueQueryScore(t, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.t.number - a.t.number)
    .slice(0, limit)
    .map((x) => x.t);
}
