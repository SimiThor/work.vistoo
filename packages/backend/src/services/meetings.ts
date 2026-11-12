import "server-only";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { TaskDTO } from "@vistoo/domain";
import {
  AGENDA_TEXT_FIELDS,
  MEETING_LIMITS,
  meetingInstants,
  type addAgendaRelationSchema,
  type AgendaItemDTO,
  type AgendaRelationCandidateDTO,
  type agendaRelationCandidatesSchema,
  type AgendaRelationDTO,
  type createAgendaItemSchema,
  type createDecisionFromAgendaSchema,
  type createIssueFromAgendaSchema,
  type createMeetingSchema,
  type MeetingDetailDTO,
  type MeetingDTO,
  type MeetingSummaryDTO,
  type reorderAgendaSchema,
  type updateAgendaItemSchema,
  type updateMeetingSchema,
} from "@vistoo/domain/meetings";
import {
  decisions,
  meetingAgendaItems,
  meetingAgendaRelations,
  meetingParticipants,
  meetings,
  tasks,
  workspaceMembers,
  type Meeting,
  type MeetingAgendaItem,
} from "@vistoo/database/schema";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import { AppError, invalid, notFound } from "../errors";
import { insertDecision } from "./decisions";
import { assertActiveMember } from "./guards";
import { notifyAssignment } from "./notifications";
import { insertTask, toTaskDTO } from "./tasks";

/**
 * "Meetings": planning, a shared agenda per meeting and the documented outcome
 * of every point. Shared by the whole workspace (every active member reads and
 * edits, like decisions). Rules:
 *   - a meeting ends after it starts, on the same day in the team's time zone
 *     (domain schema + CHECK); participants and responsible people are active
 *     members when they are added;
 *   - editing a meeting or the text of an agenda point on a stale version is
 *     rejected with CONFLICT (+ current state) instead of silently overwriting
 *     a teammate's words; status and assignment always apply (last write wins);
 *   - issues and decisions created from a point use the regular inserts
 *     (`insertTask`, `insertDecision`) and are linked in the same transaction.
 */

const POSITION_STEP = 1024;

// ---------------------------------------------------------------------------
// Mapping & loading
// ---------------------------------------------------------------------------

// Correlated subqueries with explicit aliases: inside `sql` select fields
// Drizzle renders columns unqualified, which would bind `id` to the inner table.
const summaryExtras = {
  participantIds: sql<string[]>`coalesce((
    select json_agg(p.user_id order by p.created_at, p.user_id)
    from public.meeting_participants p where p.meeting_id = "meetings"."id"), '[]'::json)`,
  agendaCount: sql<number>`(select count(*)::int from public.meeting_agenda_items a where a.meeting_id = "meetings"."id")`,
  discussedCount: sql<number>`(select count(*)::int from public.meeting_agenda_items a
    where a.meeting_id = "meetings"."id" and a.status = 'discussed')`,
};

type MeetingRow = Meeting & { participantIds: string[]; agendaCount: number; discussedCount: number };

function toSummary(m: Omit<MeetingRow, "description">): MeetingSummaryDTO {
  return {
    id: m.id,
    title: m.title,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    meetingUrl: m.meetingUrl,
    participantIds: m.participantIds ?? [],
    agendaCount: Number(m.agendaCount ?? 0),
    discussedCount: Number(m.discussedCount ?? 0),
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    version: m.version,
  };
}

const toMeetingDTO = (m: MeetingRow): MeetingDTO => ({ ...toSummary(m), description: m.description });

function toItemDTO(i: MeetingAgendaItem, relations: AgendaRelationDTO[]): AgendaItemDTO {
  return {
    id: i.id,
    meetingId: i.meetingId,
    title: i.title,
    description: i.description,
    assignedTo: i.assignedTo,
    status: i.status,
    outcome: i.outcome,
    position: i.position,
    createdBy: i.createdBy,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    version: i.version,
    relations,
  };
}

async function loadMeetingRow(db: DbOrTx, ctx: AuthContext, id: string): Promise<MeetingRow> {
  const [row] = await db
    .select({ ...getTableColumns(meetings), ...summaryExtras })
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Meeting");
  return row;
}

/** Locks the meeting row: serializes agenda inserts, reorders and meeting edits. */
async function lockMeeting(tx: Tx, ctx: AuthContext, id: string): Promise<Meeting> {
  const [row] = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!row) throw notFound("Meeting");
  return row;
}

async function findItem(db: DbOrTx, ctx: AuthContext, id: string, lock = false): Promise<MeetingAgendaItem> {
  const q = db
    .select()
    .from(meetingAgendaItems)
    .where(and(eq(meetingAgendaItems.id, id), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Agenda-Punkt");
  return row;
}

async function loadRelations(db: DbOrTx, ctx: AuthContext, itemIds: string[]): Promise<Map<string, AgendaRelationDTO[]>> {
  const out = new Map<string, AgendaRelationDTO[]>();
  if (itemIds.length === 0) return out;
  const rows = await db
    .select({
      id: meetingAgendaRelations.id,
      itemId: meetingAgendaRelations.agendaItemId,
      taskId: meetingAgendaRelations.taskId,
      decisionId: meetingAgendaRelations.decisionId,
      task: { title: tasks.title, status: tasks.status, projectId: tasks.projectId, number: tasks.number },
      decision: { title: decisions.title, status: decisions.status },
    })
    .from(meetingAgendaRelations)
    .leftJoin(tasks, and(eq(tasks.id, meetingAgendaRelations.taskId), eq(tasks.workspaceId, meetingAgendaRelations.workspaceId)))
    .leftJoin(
      decisions,
      and(eq(decisions.id, meetingAgendaRelations.decisionId), eq(decisions.workspaceId, meetingAgendaRelations.workspaceId)),
    )
    .where(and(inArray(meetingAgendaRelations.agendaItemId, itemIds), eq(meetingAgendaRelations.workspaceId, ctx.workspaceId)))
    .orderBy(asc(meetingAgendaRelations.createdAt), asc(meetingAgendaRelations.id));
  for (const r of rows) {
    let dto: AgendaRelationDTO | null = null;
    if (r.taskId && r.task?.title) {
      dto = { id: r.id, kind: "issue", targetId: r.taskId, title: r.task.title, status: r.task.status, projectId: r.task.projectId, number: r.task.number };
    } else if (r.decisionId && r.decision?.title) {
      dto = { id: r.id, kind: "decision", targetId: r.decisionId, title: r.decision.title, status: r.decision.status, projectId: null, number: null };
    }
    if (dto) out.set(r.itemId, [...(out.get(r.itemId) ?? []), dto]);
  }
  return out;
}

async function loadItem(db: DbOrTx, ctx: AuthContext, id: string): Promise<AgendaItemDTO> {
  const row = await findItem(db, ctx, id);
  const relations = await loadRelations(db, ctx, [row.id]);
  return toItemDTO(row, relations.get(row.id) ?? []);
}

async function loadAgenda(db: DbOrTx, ctx: AuthContext, meetingId: string): Promise<AgendaItemDTO[]> {
  const rows = await db
    .select()
    .from(meetingAgendaItems)
    .where(and(eq(meetingAgendaItems.meetingId, meetingId), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)))
    .orderBy(asc(meetingAgendaItems.position), asc(meetingAgendaItems.createdAt), asc(meetingAgendaItems.id));
  const relations = await loadRelations(
    db,
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toItemDTO(r, relations.get(r.id) ?? []));
}

/** All meetings of the workspace (no long texts); the client splits upcoming and past. */
export async function listMeetings(ctx: AuthContext): Promise<MeetingSummaryDTO[]> {
  const { description: _, ...columns } = getTableColumns(meetings);
  const rows = await getDb()
    .select({ ...columns, ...summaryExtras })
    .from(meetings)
    .where(eq(meetings.workspaceId, ctx.workspaceId))
    .orderBy(desc(meetings.startsAt), desc(meetings.id));
  return rows.map(toSummary);
}

export async function getMeeting(ctx: AuthContext, id: string): Promise<MeetingDetailDTO> {
  const db = getDb();
  const [meeting, agenda] = await Promise.all([loadMeetingRow(db, ctx, id), loadAgenda(db, ctx, id)]);
  return { meeting: toMeetingDTO(meeting), agenda };
}

// ---------------------------------------------------------------------------
// Meetings: create, update, delete
// ---------------------------------------------------------------------------

/** All ids must be active members of the workspace. */
async function assertActiveMembers(db: DbOrTx, ctx: AuthContext, userIds: string[]) {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        inArray(workspaceMembers.userId, userIds),
        eq(workspaceMembers.status, "active"),
      ),
    );
  if (rows.length !== new Set(userIds).size) {
    throw invalid("Mindestens eine Person ist kein aktives Mitglied.", { participantIds: "Ungültige Teilnehmende." });
  }
}

export async function createMeeting(
  ctx: AuthContext,
  input: z.output<typeof createMeetingSchema>,
): Promise<MeetingSummaryDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      // Retried create: the stored meeting if it is the caller's own.
      const [existing] = await tx.select().from(meetings).where(eq(meetings.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
          throw new AppError("CONFLICT", "Dieses Meeting konnte nicht angelegt werden.");
        }
        return toSummary(await loadMeetingRow(tx, ctx, existing.id));
      }
    }
    await assertActiveMembers(tx, ctx, input.participantIds);
    const { startsAt, endsAt } = meetingInstants(input.times);
    const [row] = await tx
      .insert(meetings)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        title: input.title,
        description: input.description,
        startsAt,
        endsAt,
        meetingUrl: input.meetingUrl,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.participantIds.length) {
      await tx
        .insert(meetingParticipants)
        .values(input.participantIds.map((userId) => ({ meetingId: row.id, workspaceId: ctx.workspaceId, userId })));
    }
    return toSummary(await loadMeetingRow(tx, ctx, row.id));
  });
}

/**
 * Partial update (only sent fields change). Rejected with CONFLICT (and the
 * current meeting) if someone else saved since the editor was opened.
 */
export async function updateMeeting(
  ctx: AuthContext,
  input: z.output<typeof updateMeetingSchema>,
): Promise<MeetingDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await lockMeeting(tx, ctx, id);
    if (current.version !== input.version) {
      throw new AppError("CONFLICT", "Das Meeting wurde inzwischen von jemand anderem geändert.", {
        current: toMeetingDTO(await loadMeetingRow(tx, ctx, id)),
      });
    }
    const set: Partial<typeof meetings.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.meetingUrl !== undefined) set.meetingUrl = patch.meetingUrl;
    if (patch.times) Object.assign(set, meetingInstants(patch.times));

    let participantsChanged = false;
    if (patch.participantIds) {
      const existing = await tx
        .select({ userId: meetingParticipants.userId })
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, id), eq(meetingParticipants.workspaceId, ctx.workspaceId)));
      const before = new Set(existing.map((p) => p.userId));
      const next = new Set(patch.participantIds);
      const added = [...next].filter((u) => !before.has(u));
      const removed = [...before].filter((u) => !next.has(u));
      // Former members already on the list may stay; new ones must be active.
      await assertActiveMembers(tx, ctx, added);
      if (removed.length) {
        await tx
          .delete(meetingParticipants)
          .where(
            and(
              eq(meetingParticipants.meetingId, id),
              eq(meetingParticipants.workspaceId, ctx.workspaceId),
              inArray(meetingParticipants.userId, removed),
            ),
          );
      }
      if (added.length) {
        await tx
          .insert(meetingParticipants)
          .values(added.map((userId) => ({ meetingId: id, workspaceId: ctx.workspaceId, userId })));
      }
      participantsChanged = added.length > 0 || removed.length > 0;
    }

    if (Object.keys(set).length > 0 || participantsChanged) {
      await tx
        .update(meetings)
        .set({ ...set, version: sql`${meetings.version} + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(and(eq(meetings.id, id), eq(meetings.workspaceId, ctx.workspaceId)));
    }
    return toMeetingDTO(await loadMeetingRow(tx, ctx, id));
  });
}

/** Deletes the meeting with participants, agenda and links (linked issues and decisions stay). */
export async function deleteMeeting(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const deleted = await getDb()
    .delete(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.workspaceId, ctx.workspaceId)))
    .returning({ id: meetings.id });
  if (deleted.length === 0) throw notFound("Meeting");
  return { id };
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export async function createAgendaItem(
  ctx: AuthContext,
  input: z.output<typeof createAgendaItemSchema>,
): Promise<AgendaItemDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(meetingAgendaItems).where(eq(meetingAgendaItems.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId || existing.meetingId !== input.meetingId) {
          throw new AppError("CONFLICT", "Dieser Agenda-Punkt konnte nicht angelegt werden.");
        }
        return loadItem(tx, ctx, existing.id);
      }
    }
    await lockMeeting(tx, ctx, input.meetingId);
    const [{ n, max }] = await tx
      .select({ n: count(), max: sql<number | null>`max(${meetingAgendaItems.position})` })
      .from(meetingAgendaItems)
      .where(and(eq(meetingAgendaItems.meetingId, input.meetingId), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)));
    if (n >= MEETING_LIMITS.agendaItemsPerMeeting) {
      throw invalid(`Eine Agenda kann höchstens ${MEETING_LIMITS.agendaItemsPerMeeting} Punkte haben.`);
    }
    if (input.assignedTo) await assertActiveMember(tx, ctx, input.assignedTo);
    const [row] = await tx
      .insert(meetingAgendaItems)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        meetingId: input.meetingId,
        title: input.title,
        description: input.description,
        assignedTo: input.assignedTo,
        position: Number(max ?? 0) + POSITION_STEP,
        createdBy: ctx.userId,
      })
      .returning();
    return toItemDTO(row, []);
  });
}

/**
 * Partial update of an agenda point. Text changes (title, description,
 * outcome) need the version the editor started from; a newer stored version
 * means someone else edited meanwhile → CONFLICT with the current point.
 * Status and responsible person always apply.
 */
export async function updateAgendaItem(
  ctx: AuthContext,
  input: z.output<typeof updateAgendaItemSchema>,
): Promise<AgendaItemDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await findItem(tx, ctx, id, true);
    const textChanged = AGENDA_TEXT_FIELDS.some((f) => patch[f] !== undefined && patch[f] !== current[f]);
    if (textChanged && input.version !== current.version) {
      throw new AppError("CONFLICT", "Dieser Agenda-Punkt wurde inzwischen von jemand anderem geändert.", {
        current: await loadItem(tx, ctx, id),
      });
    }
    if (patch.assignedTo && patch.assignedTo !== current.assignedTo) await assertActiveMember(tx, ctx, patch.assignedTo);

    const set: Partial<typeof meetingAgendaItems.$inferInsert> = {};
    for (const f of AGENDA_TEXT_FIELDS) if (patch[f] !== undefined && patch[f] !== current[f]) set[f] = patch[f];
    if (patch.status !== undefined && patch.status !== current.status) set.status = patch.status;
    if (patch.assignedTo !== undefined && patch.assignedTo !== current.assignedTo) set.assignedTo = patch.assignedTo;
    if (Object.keys(set).length === 0) return loadItem(tx, ctx, id);

    await tx
      .update(meetingAgendaItems)
      .set({ ...set, version: sql`${meetingAgendaItems.version} + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(meetingAgendaItems.id, id), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)));
    return loadItem(tx, ctx, id);
  });
}

export async function deleteAgendaItem(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const deleted = await getDb()
    .delete(meetingAgendaItems)
    .where(and(eq(meetingAgendaItems.id, id), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)))
    .returning({ id: meetingAgendaItems.id });
  if (deleted.length === 0) throw notFound("Agenda-Punkt");
  return { id };
}

/**
 * New order of the agenda. Points not in `ids` (e.g. added by someone else
 * while dragging) keep their relative order after the given ones, so nothing
 * is lost. Returns the stored order.
 */
export async function reorderAgenda(
  ctx: AuthContext,
  input: z.output<typeof reorderAgendaSchema>,
): Promise<{ id: string; position: number }[]> {
  return getDb().transaction(async (tx) => {
    await lockMeeting(tx, ctx, input.meetingId);
    const rows = await tx
      .select({ id: meetingAgendaItems.id, position: meetingAgendaItems.position })
      .from(meetingAgendaItems)
      .where(and(eq(meetingAgendaItems.meetingId, input.meetingId), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)))
      .orderBy(asc(meetingAgendaItems.position), asc(meetingAgendaItems.createdAt), asc(meetingAgendaItems.id));
    const known = new Set(rows.map((r) => r.id));
    const requested = [...new Set(input.ids)].filter((id) => known.has(id));
    const rest = rows.map((r) => r.id).filter((id) => !requested.includes(id));
    const order = [...requested, ...rest];
    const current = new Map(rows.map((r) => [r.id, r.position]));
    for (const [i, id] of order.entries()) {
      const position = (i + 1) * POSITION_STEP;
      if (current.get(id) === position) continue;
      await tx
        .update(meetingAgendaItems)
        .set({ position })
        .where(and(eq(meetingAgendaItems.id, id), eq(meetingAgendaItems.workspaceId, ctx.workspaceId)));
    }
    return order.map((id, i) => ({ id, position: (i + 1) * POSITION_STEP }));
  });
}

// ---------------------------------------------------------------------------
// Linked issues and decisions
// ---------------------------------------------------------------------------

/** Escapes LIKE wildcards in user input. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Issues or decisions of the workspace that can still be linked, matching the query (newest changes first). */
export async function listAgendaRelationCandidates(
  ctx: AuthContext,
  input: z.output<typeof agendaRelationCandidatesSchema>,
): Promise<AgendaRelationCandidateDTO[]> {
  const db = getDb();
  await findItem(db, ctx, input.itemId);
  const linked = await db
    .select({ taskId: meetingAgendaRelations.taskId, decisionId: meetingAgendaRelations.decisionId })
    .from(meetingAgendaRelations)
    .where(and(eq(meetingAgendaRelations.agendaItemId, input.itemId), eq(meetingAgendaRelations.workspaceId, ctx.workspaceId)));
  const q = input.query.trim();
  const limit = 8;

  if (input.kind === "issue") {
    const linkedTasks = linked.flatMap((l) => (l.taskId ? [l.taskId] : []));
    // "#42" or "42" also finds the issue with that number.
    const asNumber = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
    const rows = await db
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
      .limit(limit);
    return rows.map((t) => ({ kind: "issue", targetId: t.id, title: t.title, status: t.status, projectId: t.projectId, number: t.number }));
  }

  const linkedDecisions = linked.flatMap((l) => (l.decisionId ? [l.decisionId] : []));
  const rows = await db
    .select({ id: decisions.id, title: decisions.title, status: decisions.status })
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, ctx.workspaceId),
        q ? ilike(decisions.title, likePattern(q)) : undefined,
        linkedDecisions.length ? notInArray(decisions.id, linkedDecisions) : undefined,
      ),
    )
    .orderBy(desc(decisions.updatedAt))
    .limit(limit);
  return rows.map((d) => ({ kind: "decision", targetId: d.id, title: d.title, status: d.status, projectId: null, number: null }));
}

async function insertRelation(
  tx: Tx,
  ctx: AuthContext,
  itemId: string,
  target: { taskId: string } | { decisionId: string },
) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(meetingAgendaRelations)
    .where(and(eq(meetingAgendaRelations.agendaItemId, itemId), eq(meetingAgendaRelations.workspaceId, ctx.workspaceId)));
  if (n >= MEETING_LIMITS.relationsPerItem) {
    throw invalid(`Ein Agenda-Punkt kann höchstens ${MEETING_LIMITS.relationsPerItem} Verknüpfungen haben.`);
  }
  await tx
    .insert(meetingAgendaRelations)
    .values({
      workspaceId: ctx.workspaceId,
      agendaItemId: itemId,
      taskId: "taskId" in target ? target.taskId : null,
      decisionId: "decisionId" in target ? target.decisionId : null,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing();
}

/** Links an existing issue or decision of the same workspace. Linking twice is a no-op. */
export async function addAgendaRelation(
  ctx: AuthContext,
  input: z.output<typeof addAgendaRelationSchema>,
): Promise<AgendaItemDTO> {
  return getDb().transaction(async (tx) => {
    await findItem(tx, ctx, input.itemId, true);
    const target =
      input.kind === "issue"
        ? await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.targetId), eq(tasks.workspaceId, ctx.workspaceId)))
        : await tx
            .select({ id: decisions.id })
            .from(decisions)
            .where(and(eq(decisions.id, input.targetId), eq(decisions.workspaceId, ctx.workspaceId)));
    if (target.length === 0) throw notFound(input.kind === "issue" ? "Issue" : "Entscheidung");
    await insertRelation(tx, ctx, input.itemId, input.kind === "issue" ? { taskId: input.targetId } : { decisionId: input.targetId });
    return loadItem(tx, ctx, input.itemId);
  });
}

/** Removes only the link; the issue or decision itself stays. */
export async function removeAgendaRelation(ctx: AuthContext, id: string): Promise<AgendaItemDTO> {
  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(meetingAgendaRelations)
      .where(and(eq(meetingAgendaRelations.id, id), eq(meetingAgendaRelations.workspaceId, ctx.workspaceId)))
      .returning({ itemId: meetingAgendaRelations.agendaItemId });
    if (deleted.length === 0) throw notFound("Verknüpfung");
    return loadItem(tx, ctx, deleted[0].itemId);
  });
}

/**
 * "Issue erstellen": a regular task (the same insert as everywhere else) in
 * the chosen project, linked to the agenda point in one transaction. A
 * retried request with the same task id links the existing task instead of
 * creating a second one.
 */
export async function createIssueFromAgendaItem(
  ctx: AuthContext,
  input: z.output<typeof createIssueFromAgendaSchema>,
): Promise<{ item: AgendaItemDTO; task: TaskDTO }> {
  let created = false;
  const result = await getDb().transaction(async (tx) => {
    await findItem(tx, ctx, input.itemId, true);
    let task = null;
    if (input.id) {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, input.id));
      if (existing && (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId)) {
        throw new AppError("CONFLICT", "Diese Aufgabe konnte nicht angelegt werden.");
      }
      task = existing ?? null;
    }
    if (!task) {
      task = await insertTask(tx, ctx, {
        id: input.id,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        status: "open",
        milestoneId: null,
        assigneeId: input.assigneeId,
        startDate: null,
        endDate: null,
      });
      created = true;
    }
    await insertRelation(tx, ctx, input.itemId, { taskId: task.id });
    return { item: await loadItem(tx, ctx, input.itemId), task: toTaskDTO(task) };
  });
  if (created) notifyAssignment(ctx, result.task);
  return result;
}

/**
 * "Entscheidung erstellen": a regular decision (status "Offen"), responsible
 * person taken over from the agenda point if still active, linked in one transaction.
 */
export async function createDecisionFromAgendaItem(
  ctx: AuthContext,
  input: z.output<typeof createDecisionFromAgendaSchema>,
): Promise<{ item: AgendaItemDTO; decisionId: string }> {
  return getDb().transaction(async (tx) => {
    const item = await findItem(tx, ctx, input.itemId, true);
    let assigneeId: string | null = null;
    if (item.assignedTo) {
      const [active] = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(workspaceMembers.userId, item.assignedTo),
            eq(workspaceMembers.status, "active"),
          ),
        );
      assigneeId = active ? item.assignedTo : null;
    }
    const decision = await insertDecision(tx, ctx, {
      id: input.id,
      type: "decision",
      title: input.title,
      description: input.description,
      assigneeId,
    });
    await insertRelation(tx, ctx, input.itemId, { decisionId: decision.id });
    return { item: await loadItem(tx, ctx, input.itemId), decisionId: decision.id };
  });
}
