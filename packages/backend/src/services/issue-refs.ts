import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { IssueRefDTO } from "@vistoo/domain";
import { rankIssues } from "@vistoo/domain/issue-refs";
import type { searchIssuesSchema } from "@vistoo/domain/validation";
import { projects, tasks } from "@vistoo/database/schema";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx } from "../db";
import { invalid } from "../errors";

/*
 * `#` references to tasks ("issues").
 *
 * Access: every active member of a workspace may read all of its tasks
 * (same rule as listTasks/getTask and the RLS policy on `tasks`). So a
 * reference is visible to a reader exactly when the task still exists in the
 * reader's workspace. Ids from requests prove nothing: every lookup is scoped
 * to `ctx.workspaceId`, and foreign or deleted ids behave alike (unresolved).
 */

export const MAX_ISSUE_REFS_PER_MESSAGE = 20;
const PICKER_LIMIT = 8;
const CANDIDATES = 60;

const refColumns = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  status: tasks.status,
  projectId: tasks.projectId,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Candidates for the `#` picker: number (exact or prefix) and title words.
 * Tasks of archived projects are left out to keep the list short; existing
 * references to them still resolve.
 */
export async function searchIssues(ctx: AuthContext, input: z.output<typeof searchIssuesSchema>): Promise<IssueRefDTO[]> {
  const q = input.q.trim().replace(/^#/, "").trim();
  const digits = /^\d{1,9}$/.test(q) ? q : null;
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);

  const textMatch = words.length
    ? and(...words.map((w) => sql`${tasks.title} ILIKE ${`%${escapeLike(w)}%`}`))
    : undefined;
  const match = digits
    ? or(sql`${tasks.number}::text LIKE ${`${digits}%`}`, textMatch)
    : textMatch;

  const rows = await getDb()
    .select(refColumns)
    .from(tasks)
    .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.workspaceId, tasks.workspaceId)))
    .where(and(eq(tasks.workspaceId, ctx.workspaceId), isNull(projects.archivedAt), match))
    .orderBy(desc(tasks.number))
    .limit(CANDIDATES);
  return rankIssues(rows, q, PICKER_LIMIT);
}

/** Display data of referenced tasks that exist in the caller's workspace. */
export async function resolveIssueRefs(db: DbOrTx, ctx: AuthContext, ids: readonly string[]): Promise<IssueRefDTO[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return db
    .select(refColumns)
    .from(tasks)
    .where(and(eq(tasks.workspaceId, ctx.workspaceId), inArray(tasks.id, unique)));
}

/**
 * New references in a message must point to existing tasks of the workspace.
 * References already present in an edited message stay allowed even if the
 * task was deleted since (they render as "deleted task").
 */
export async function assertReferenceable(
  db: DbOrTx,
  ctx: AuthContext,
  ids: readonly string[],
  alreadyReferenced: readonly string[] = [],
): Promise<void> {
  if (ids.length > MAX_ISSUE_REFS_PER_MESSAGE) {
    const msg = `Du kannst höchstens ${MAX_ISSUE_REFS_PER_MESSAGE} Aufgaben in einer Nachricht verlinken.`;
    throw invalid(msg, { body: msg });
  }
  const added = ids.filter((id) => !alreadyReferenced.includes(id));
  if (added.length === 0) return;
  const found = await resolveIssueRefs(db, ctx, added);
  if (found.length !== added.length) {
    const msg = "Mindestens eine verlinkte Aufgabe gibt es nicht (mehr).";
    throw invalid(msg, { body: msg });
  }
}
