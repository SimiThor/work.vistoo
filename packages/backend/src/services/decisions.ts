import "server-only";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  completionErrors,
  DECISION_LIMITS,
  isConcluded,
  isStatusOfType,
  previewOf,
  statusForType,
  teamToday,
  TRACKED_FIELDS,
  type addDecisionRelationSchema,
  type createDecisionLinkSchema,
  type createDecisionSchema,
  type DecisionDetailDTO,
  type DecisionDTO,
  type DecisionHistoryDTO,
  type DecisionLinkDTO,
  type DecisionRef,
  type DecisionRelationDTO,
  type DecisionSummaryDTO,
  type HistoryDetails,
  type HistoryKind,
  type listDecisionsSchema,
  type relationCandidatesSchema,
  type RelationCandidateDTO,
  type supersedeDecisionSchema,
  type TrackedField,
  type updateDecisionLinkSchema,
  type updateDecisionSchema,
} from "@vistoo/domain/decisions";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import {
  decisionHistory,
  decisionLinks,
  decisionRelations,
  decisions,
  ideas,
  tasks,
  type Decision,
  type DecisionHistory,
  type DecisionLink,
} from "@vistoo/database/schema";
import { AppError, invalid, notFound } from "../errors";
import { assertActiveMember } from "./guards";

/**
 * "Decisions": decisions and experiments, shared by the whole workspace
 * (every active member reads and edits). Rules that keep the record
 * trustworthy live here and, as a backstop, in CHECK constraints:
 *   - the status must belong to the type;
 *   - concluding requires a documented result and reasoning, and sets the
 *     day of the decision (editable);
 *   - "superseded" is only reachable via `supersedeDecision`, which keeps
 *     the old decision intact and points it to its successor;
 *   - changes to concluded entries are recorded in an append-only history.
 */

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toSummary(d: Decision): DecisionSummaryDTO {
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    status: d.status,
    assigneeId: d.assigneeId,
    createdBy: d.createdBy,
    // Experiments document their result in `results` (no separate conclusion).
    outcomePreview: previewOf(d.type === "experiment" ? d.results : d.outcome),
    concludedOn: d.concludedOn,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toDecisionDTO(d: Decision, supersededBy: DecisionRef | null, supersedes: DecisionRef[]): DecisionDTO {
  const { outcomePreview: _, ...summary } = toSummary(d);
  return {
    ...summary,
    description: d.description,
    optionsConsidered: d.optionsConsidered,
    objective: d.objective,
    testDescription: d.testDescription,
    results: d.results,
    outcome: d.outcome,
    reasoning: d.reasoning,
    supersededBy,
    supersedes,
  };
}

function toLinkDTO(l: DecisionLink): DecisionLinkDTO {
  return {
    id: l.id,
    decisionId: l.decisionId,
    url: l.url,
    title: l.title,
    createdBy: l.createdBy,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toHistoryDTO(h: DecisionHistory): DecisionHistoryDTO {
  return { id: h.id, kind: h.kind, actorId: h.actorId, createdAt: h.createdAt.toISOString(), details: h.details };
}

const refColumns = { id: decisions.id, title: decisions.title, status: decisions.status };


// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function findDecision(db: DbOrTx, ctx: AuthContext, id: string, lock = false): Promise<Decision> {
  const q = db
    .select()
    .from(decisions)
    .where(and(eq(decisions.id, id), eq(decisions.workspaceId, ctx.workspaceId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Eintrag");
  return row;
}

async function loadDecision(db: DbOrTx, ctx: AuthContext, row: Decision): Promise<DecisionDTO> {
  const [successor] = row.supersededById
    ? await db
        .select(refColumns)
        .from(decisions)
        .where(and(eq(decisions.id, row.supersededById), eq(decisions.workspaceId, ctx.workspaceId)))
    : [];
  const predecessors = await db
    .select(refColumns)
    .from(decisions)
    .where(and(eq(decisions.supersededById, row.id), eq(decisions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(decisions.concludedOn), desc(decisions.createdAt));
  return toDecisionDTO(row, successor ?? null, predecessors);
}

async function listRelations(db: DbOrTx, ctx: AuthContext, decisionId: string): Promise<DecisionRelationDTO[]> {
  const rows = await db
    .select({
      id: decisionRelations.id,
      taskId: decisionRelations.taskId,
      ideaId: decisionRelations.ideaId,
      task: { title: tasks.title, status: tasks.status, projectId: tasks.projectId, number: tasks.number },
      idea: { title: ideas.title, status: ideas.status },
    })
    .from(decisionRelations)
    .leftJoin(tasks, and(eq(tasks.id, decisionRelations.taskId), eq(tasks.workspaceId, decisionRelations.workspaceId)))
    .leftJoin(ideas, and(eq(ideas.id, decisionRelations.ideaId), eq(ideas.workspaceId, decisionRelations.workspaceId)))
    .where(and(eq(decisionRelations.decisionId, decisionId), eq(decisionRelations.workspaceId, ctx.workspaceId)))
    .orderBy(asc(decisionRelations.createdAt), asc(decisionRelations.id));
  return rows.flatMap((r): DecisionRelationDTO[] => {
    if (r.taskId && r.task?.title) {
      return [
        { id: r.id, kind: "issue", targetId: r.taskId, title: r.task.title, status: r.task.status, projectId: r.task.projectId, number: r.task.number },
      ];
    }
    if (r.ideaId && r.idea?.title) {
      return [{ id: r.id, kind: "idea", targetId: r.ideaId, title: r.idea.title, status: r.idea.status, projectId: null, number: null }];
    }
    return [];
  });
}

async function loadDetail(db: DbOrTx, ctx: AuthContext, id: string): Promise<DecisionDetailDTO> {
  const row = await findDecision(db, ctx, id);
  const [decision, links, relations, history] = await Promise.all([
    loadDecision(db, ctx, row),
    db
      .select()
      .from(decisionLinks)
      .where(and(eq(decisionLinks.decisionId, id), eq(decisionLinks.workspaceId, ctx.workspaceId)))
      .orderBy(asc(decisionLinks.createdAt), asc(decisionLinks.id)),
    listRelations(db, ctx, id),
    db
      .select()
      .from(decisionHistory)
      .where(and(eq(decisionHistory.decisionId, id), eq(decisionHistory.workspaceId, ctx.workspaceId)))
      .orderBy(desc(decisionHistory.createdAt), desc(decisionHistory.id)),
  ]);
  return { decision, links: links.map(toLinkDTO), relations, history: history.map(toHistoryDTO) };
}

export async function getDecision(ctx: AuthContext, id: string): Promise<DecisionDetailDTO> {
  return loadDetail(getDb(), ctx, id);
}

/**
 * Words of a search query as a prefix tsquery ("lang chain" → `lang:* & chain:*`).
 * Only letters and digits reach the query, so user input can never form
 * tsquery syntax.
 */
export function toPrefixQuery(query: string): string | null {
  const words = query.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(words)].slice(0, 10);
  return unique.length ? unique.map((w) => `${w}:*`).join(" & ") : null;
}

/** Overview: full-text search plus filters, sorted on the server. */
export async function listDecisions(
  ctx: AuthContext,
  input: z.output<typeof listDecisionsSchema>,
): Promise<DecisionSummaryDTO[]> {
  const conditions: (SQL | undefined)[] = [eq(decisions.workspaceId, ctx.workspaceId)];
  const tsquery = toPrefixQuery(input.query);
  if (tsquery) conditions.push(sql`${decisions.search} @@ to_tsquery('simple'::regconfig, ${tsquery})`);
  if (input.type) conditions.push(eq(decisions.type, input.type));
  if (input.status) conditions.push(eq(decisions.status, input.status));
  if (input.assigneeId === "none") conditions.push(isNull(decisions.assigneeId));
  else if (input.assigneeId) conditions.push(eq(decisions.assigneeId, input.assigneeId));
  const order =
    input.sort === "created"
      ? [desc(decisions.createdAt), desc(decisions.id)]
      : input.sort === "created_asc"
        ? [asc(decisions.createdAt), asc(decisions.id)]
        : [desc(decisions.updatedAt), desc(decisions.id)];
  // Long texts are not needed for the overview; only the outcome/result preview.
  const { search: _, ...columns } = getTableColumns(decisions);
  const rows = await getDb()
    .select(columns)
    .from(decisions)
    .where(and(...conditions))
    .orderBy(...order);
  return rows.map((r) => toSummary(r as Decision));
}

// ---------------------------------------------------------------------------
// Create, update, delete
// ---------------------------------------------------------------------------

async function addHistory(tx: Tx, ctx: AuthContext, decisionId: string, kind: HistoryKind, details: HistoryDetails) {
  await tx.insert(decisionHistory).values({ workspaceId: ctx.workspaceId, decisionId, kind, details, actorId: ctx.userId });
}

async function touch(tx: Tx, ctx: AuthContext, id: string) {
  await tx
    .update(decisions)
    .set({ updatedAt: new Date() })
    .where(and(eq(decisions.id, id), eq(decisions.workspaceId, ctx.workspaceId)));
}

/** The one way to insert a decision; runs inside the caller's transaction (e.g. from a meeting's agenda). */
export async function insertDecision(
  tx: Tx,
  ctx: AuthContext,
  input: z.output<typeof createDecisionSchema>,
): Promise<Decision> {
  if (input.id) {
    // Retried create: return the stored entry if it is the caller's own.
    const [existing] = await tx.select().from(decisions).where(eq(decisions.id, input.id));
    if (existing) {
      if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
        throw new AppError("CONFLICT", "Dieser Eintrag konnte nicht angelegt werden.");
      }
      return existing;
    }
  }
  if (input.assigneeId) await assertActiveMember(tx, ctx, input.assigneeId);
  const [row] = await tx
    .insert(decisions)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      type: input.type,
      title: input.title,
      description: input.description,
      status: input.type === "decision" ? "open" : "planned",
      assigneeId: input.assigneeId,
      createdBy: ctx.userId,
    })
    .returning();
  return row;
}

/** Only the title is required; everything else can be documented later. */
export async function createDecision(
  ctx: AuthContext,
  input: z.output<typeof createDecisionSchema>,
): Promise<DecisionSummaryDTO> {
  return getDb().transaction(async (tx) => toSummary(await insertDecision(tx, ctx, input)));
}

const valueOf = (d: Decision, f: TrackedField): string | null => d[f];

/**
 * Partial update (only sent fields change). Status changes are validated
 * against the type and the completion rules; concluding sets the day of the
 * decision; changes to concluded entries are written to the history.
 */
export async function updateDecision(
  ctx: AuthContext,
  input: z.output<typeof updateDecisionSchema>,
): Promise<DecisionDetailDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await findDecision(tx, ctx, id, true);
    const wasConcluded = isConcluded(current.status);

    const type = patch.type ?? current.type;
    if (type !== current.type && wasConcluded) {
      throw invalid("Abgeschlossene Einträge behalten ihren Typ.", { type: "Der Typ kann nicht mehr geändert werden." });
    }
    const status = patch.status ?? (type !== current.type ? statusForType(type, current.status) : current.status);
    if (!isStatusOfType(type, status)) {
      throw invalid("Dieser Status passt nicht zum Typ.", { status: "Ungültiger Status." });
    }
    if (status === "superseded" && current.status !== "superseded") {
      throw invalid("Eine Entscheidung wird über „Ersetzen“ durch eine neue abgelöst.", {
        status: "Bitte „Ersetzen“ verwenden.",
      });
    }
    if (patch.assigneeId && patch.assigneeId !== current.assigneeId) await assertActiveMember(tx, ctx, patch.assigneeId);

    const next = {
      type,
      status,
      title: patch.title ?? current.title,
      assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : current.assigneeId,
      description: patch.description ?? current.description,
      optionsConsidered: patch.optionsConsidered ?? current.optionsConsidered,
      objective: patch.objective ?? current.objective,
      testDescription: patch.testDescription ?? current.testDescription,
      results: patch.results ?? current.results,
      outcome: patch.outcome ?? current.outcome,
      reasoning: patch.reasoning ?? current.reasoning,
      concludedOn: null as string | null,
      supersededById: status === "superseded" ? current.supersededById : null,
    };

    const nowConcluded = isConcluded(status);
    if (nowConcluded) {
      const missing = completionErrors(next);
      if (Object.keys(missing).length > 0) {
        throw invalid(
          type === "decision"
            ? "Zum Abschluss brauchen wir die finale Entscheidung und eine Begründung."
            : "Zum Abschluss brauchen wir ein Ergebnis.",
          missing,
        );
      }
      next.concludedOn = patch.concludedOn ?? current.concludedOn ?? teamToday();
    }

    const changed = TRACKED_FIELDS.filter((f) => valueOf(current, f) !== next[f]);
    const assigneeChanged = next.assigneeId !== current.assigneeId;
    if (changed.length === 0 && !assigneeChanged && next.type === current.type) return loadDetail(tx, ctx, id);

    await tx
      .update(decisions)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(decisions.id, id), eq(decisions.workspaceId, ctx.workspaceId)));

    if (!wasConcluded && nowConcluded) {
      await addHistory(tx, ctx, id, "concluded", { fromStatus: current.status, toStatus: status });
    } else if (wasConcluded && (!nowConcluded || current.status === "superseded") && status !== current.status) {
      await addHistory(tx, ctx, id, "reopened", { fromStatus: current.status, toStatus: status });
    } else if (wasConcluded && nowConcluded) {
      const fields = changed.filter((f) => f !== "status" || status !== current.status);
      if (fields.length > 0) {
        const previous = Object.fromEntries(fields.map((f) => [f, valueOf(current, f)]));
        await addHistory(tx, ctx, id, "edited", {
          fields,
          previous,
          ...(status !== current.status ? { fromStatus: current.status, toStatus: status } : {}),
        });
      }
    }
    return loadDetail(tx, ctx, id);
  });
}

/**
 * Replaces a decided decision by a newer one (an existing decision or a new
 * one created here). The old decision stays complete, becomes "superseded"
 * and points to its successor; the history records who did it.
 */
export async function supersedeDecision(
  ctx: AuthContext,
  input: z.output<typeof supersedeDecisionSchema>,
): Promise<{ decision: DecisionDetailDTO; successor: DecisionSummaryDTO }> {
  return getDb().transaction(async (tx) => {
    const old = await findDecision(tx, ctx, input.id, true);
    const requested = input.successorId ?? input.newId;
    // Retried request: already done.
    if (old.status === "superseded" && requested && old.supersededById === requested) {
      return { decision: await loadDetail(tx, ctx, old.id), successor: toSummary(await findDecision(tx, ctx, requested)) };
    }
    if (old.type !== "decision" || old.status !== "decided") {
      throw invalid("Nur getroffene Entscheidungen („Entschieden“) können ersetzt werden.");
    }

    let successor: Decision;
    if (input.successorId) {
      if (input.successorId === old.id) throw invalid("Eine Entscheidung kann sich nicht selbst ersetzen.");
      successor = await findDecision(tx, ctx, input.successorId, true);
      if (successor.type !== "decision") throw invalid("Eine Entscheidung kann nur durch eine Entscheidung ersetzt werden.");
      // A current decision never points anywhere, so no cycle can form.
      if (successor.status === "superseded") throw invalid("Diese Entscheidung wurde selbst bereits ersetzt.");
    } else {
      successor = await insertDecision(tx, ctx, {
        id: input.newId,
        type: "decision",
        title: input.newTitle!,
        description: "",
        assigneeId: old.assigneeId,
      });
    }

    await tx
      .update(decisions)
      .set({ status: "superseded", supersededById: successor.id, updatedAt: new Date() })
      .where(and(eq(decisions.id, old.id), eq(decisions.workspaceId, ctx.workspaceId)));
    await addHistory(tx, ctx, old.id, "superseded", {
      fromStatus: old.status,
      toStatus: "superseded",
      supersededBy: successor.id,
    });
    await touch(tx, ctx, successor.id);
    return {
      decision: await loadDetail(tx, ctx, old.id),
      successor: toSummary(await findDecision(tx, ctx, successor.id)),
    };
  });
}

/**
 * Deletes an entry with its links, relations and history. Decisions it had
 * replaced become current again ("decided"), recorded in their history.
 */
export async function deleteDecision(ctx: AuthContext, id: string): Promise<{ id: string; restored: string[] }> {
  return getDb().transaction(async (tx) => {
    await findDecision(tx, ctx, id, true);
    const predecessors = await tx
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.supersededById, id), eq(decisions.workspaceId, ctx.workspaceId)))
      .for("update");
    for (const p of predecessors) {
      await tx
        .update(decisions)
        .set({ status: "decided", supersededById: null, updatedAt: new Date() })
        .where(and(eq(decisions.id, p.id), eq(decisions.workspaceId, ctx.workspaceId)));
      await addHistory(tx, ctx, p.id, "reopened", {
        fromStatus: "superseded",
        toStatus: "decided",
        reason: "successor_deleted",
      });
    }
    await tx.delete(decisions).where(and(eq(decisions.id, id), eq(decisions.workspaceId, ctx.workspaceId)));
    return { id, restored: predecessors.map((p) => p.id) };
  });
}

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

async function findLink(db: DbOrTx, ctx: AuthContext, id: string): Promise<DecisionLink> {
  const [row] = await db
    .select()
    .from(decisionLinks)
    .where(and(eq(decisionLinks.id, id), eq(decisionLinks.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Link");
  return row;
}

const titleOrNull = (title: string | null) => (title ? title : null);

export async function listDecisionLinks(ctx: AuthContext, decisionId: string): Promise<DecisionLinkDTO[]> {
  const db = getDb();
  await findDecision(db, ctx, decisionId);
  const rows = await db
    .select()
    .from(decisionLinks)
    .where(and(eq(decisionLinks.decisionId, decisionId), eq(decisionLinks.workspaceId, ctx.workspaceId)))
    .orderBy(asc(decisionLinks.createdAt), asc(decisionLinks.id));
  return rows.map(toLinkDTO);
}

export async function createDecisionLink(
  ctx: AuthContext,
  input: z.output<typeof createDecisionLinkSchema>,
): Promise<DecisionLinkDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(decisionLinks).where(eq(decisionLinks.id, input.id));
      if (existing) {
        if (
          existing.workspaceId !== ctx.workspaceId ||
          existing.createdBy !== ctx.userId ||
          existing.decisionId !== input.decisionId
        ) {
          throw new AppError("CONFLICT", "Dieser Link konnte nicht angelegt werden.");
        }
        return toLinkDTO(existing);
      }
    }
    // Lock serializes link changes per entry (limit check).
    await findDecision(tx, ctx, input.decisionId, true);
    const [{ n }] = await tx
      .select({ n: count() })
      .from(decisionLinks)
      .where(and(eq(decisionLinks.decisionId, input.decisionId), eq(decisionLinks.workspaceId, ctx.workspaceId)));
    if (n >= DECISION_LIMITS.linksPerEntry) {
      throw invalid(`Ein Eintrag kann höchstens ${DECISION_LIMITS.linksPerEntry} Links haben.`);
    }
    const [row] = await tx
      .insert(decisionLinks)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        decisionId: input.decisionId,
        url: input.url,
        title: titleOrNull(input.title),
        createdBy: ctx.userId,
      })
      .returning();
    await touch(tx, ctx, input.decisionId);
    return toLinkDTO(row);
  });
}

export async function updateDecisionLink(
  ctx: AuthContext,
  input: z.output<typeof updateDecisionLinkSchema>,
): Promise<DecisionLinkDTO> {
  return getDb().transaction(async (tx) => {
    const current = await findLink(tx, ctx, input.id);
    const [row] = await tx
      .update(decisionLinks)
      .set({ url: input.url, title: titleOrNull(input.title), updatedAt: new Date() })
      .where(and(eq(decisionLinks.id, current.id), eq(decisionLinks.workspaceId, ctx.workspaceId)))
      .returning();
    await touch(tx, ctx, current.decisionId);
    return toLinkDTO(row);
  });
}

export async function deleteDecisionLink(ctx: AuthContext, id: string): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    const current = await findLink(tx, ctx, id);
    await tx.delete(decisionLinks).where(and(eq(decisionLinks.id, id), eq(decisionLinks.workspaceId, ctx.workspaceId)));
    await touch(tx, ctx, current.decisionId);
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Linked issues and ideas
// ---------------------------------------------------------------------------

/** Escapes LIKE wildcards in user input. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Issues and ideas of the workspace that can still be linked to the entry,
 * matching the query in their title (most recently changed first).
 */
export async function listRelationCandidates(
  ctx: AuthContext,
  input: z.output<typeof relationCandidatesSchema>,
): Promise<RelationCandidateDTO[]> {
  const db = getDb();
  await findDecision(db, ctx, input.decisionId);
  const linked = await db
    .select({ taskId: decisionRelations.taskId, ideaId: decisionRelations.ideaId })
    .from(decisionRelations)
    .where(and(eq(decisionRelations.decisionId, input.decisionId), eq(decisionRelations.workspaceId, ctx.workspaceId)));
  const linkedTasks = linked.flatMap((l) => (l.taskId ? [l.taskId] : []));
  const linkedIdeas = linked.flatMap((l) => (l.ideaId ? [l.ideaId] : []));
  const q = input.query.trim();
  const limit = 8;
  // "#42" or "42" also finds the issue with that number.
  const asNumber = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
  const ideaQuery = q.replace(/^#/, "");

  const [taskRows, ideaRows] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, projectId: tasks.projectId, number: tasks.number })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, ctx.workspaceId),
          q ? or(ilike(tasks.title, likePattern(q)), asNumber !== null ? eq(tasks.number, asNumber) : undefined) : undefined,
          linkedTasks.length ? notInArray(tasks.id, linkedTasks) : undefined,
        ),
      )
      .orderBy(asNumber !== null ? sql`${tasks.number} = ${asNumber} desc` : desc(tasks.updatedAt), desc(tasks.updatedAt))
      .limit(limit),
    db
      .select({ id: ideas.id, title: ideas.title, status: ideas.status })
      .from(ideas)
      .where(
        and(
          eq(ideas.workspaceId, ctx.workspaceId),
          ideaQuery ? ilike(ideas.title, likePattern(ideaQuery)) : undefined,
          linkedIdeas.length ? notInArray(ideas.id, linkedIdeas) : undefined,
        ),
      )
      .orderBy(desc(ideas.updatedAt))
      .limit(limit),
  ]);
  return [
    ...taskRows.map(
      (t): RelationCandidateDTO => ({ kind: "issue", targetId: t.id, title: t.title, status: t.status, projectId: t.projectId, number: t.number }),
    ),
    ...ideaRows.map(
      (i): RelationCandidateDTO => ({ kind: "idea", targetId: i.id, title: i.title, status: i.status, projectId: null, number: null }),
    ),
  ];
}

/** Links an existing issue or idea of the same workspace. Linking twice is a no-op. */
export async function addDecisionRelation(
  ctx: AuthContext,
  input: z.output<typeof addDecisionRelationSchema>,
): Promise<DecisionRelationDTO[]> {
  return getDb().transaction(async (tx) => {
    await findDecision(tx, ctx, input.decisionId, true);
    const target =
      input.kind === "issue"
        ? await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(and(eq(tasks.id, input.targetId), eq(tasks.workspaceId, ctx.workspaceId)))
        : await tx
            .select({ id: ideas.id })
            .from(ideas)
            .where(and(eq(ideas.id, input.targetId), eq(ideas.workspaceId, ctx.workspaceId)));
    if (target.length === 0) throw notFound(input.kind === "issue" ? "Issue" : "Idee");

    const [{ n }] = await tx
      .select({ n: count() })
      .from(decisionRelations)
      .where(and(eq(decisionRelations.decisionId, input.decisionId), eq(decisionRelations.workspaceId, ctx.workspaceId)));
    if (n >= DECISION_LIMITS.relationsPerEntry) {
      throw invalid(`Ein Eintrag kann höchstens ${DECISION_LIMITS.relationsPerEntry} Verknüpfungen haben.`);
    }
    const inserted = await tx
      .insert(decisionRelations)
      .values({
        workspaceId: ctx.workspaceId,
        decisionId: input.decisionId,
        taskId: input.kind === "issue" ? input.targetId : null,
        ideaId: input.kind === "idea" ? input.targetId : null,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: decisionRelations.id });
    if (inserted.length > 0) await touch(tx, ctx, input.decisionId);
    return listRelations(tx, ctx, input.decisionId);
  });
}

export async function removeDecisionRelation(ctx: AuthContext, id: string): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(decisionRelations)
      .where(and(eq(decisionRelations.id, id), eq(decisionRelations.workspaceId, ctx.workspaceId)))
      .returning({ decisionId: decisionRelations.decisionId });
    if (deleted.length === 0) throw notFound("Verknüpfung");
    await touch(tx, ctx, deleted[0].decisionId);
    return { id };
  });
}

/** Decisions that can replace `id` (for the "Ersetzen" picker): current decisions, newest first. */
export async function listSupersedeCandidates(ctx: AuthContext, id: string): Promise<DecisionRef[]> {
  const db = getDb();
  await findDecision(db, ctx, id);
  return db
    .select(refColumns)
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, ctx.workspaceId),
        eq(decisions.type, "decision"),
        inArray(decisions.status, ["open", "in_discussion", "decided"]),
        ne(decisions.id, id),
      ),
    )
    .orderBy(desc(decisions.updatedAt))
    .limit(200);
}
