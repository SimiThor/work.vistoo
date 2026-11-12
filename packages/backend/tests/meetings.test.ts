import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import {
  addAgendaRelationSchema,
  agendaRelationCandidatesSchema,
  createAgendaItemSchema,
  createDecisionFromAgendaSchema,
  createIssueFromAgendaSchema,
  createMeetingSchema,
  reorderAgendaSchema,
  updateAgendaItemSchema,
  updateMeetingSchema,
  type CreateMeetingInput,
} from "@vistoo/domain/meetings";
import { createTaskSchema } from "@vistoo/domain/validation";
import {
  addAgendaRelation,
  createAgendaItem,
  createDecisionFromAgendaItem,
  createIssueFromAgendaItem,
  createMeeting,
  deleteAgendaItem,
  deleteMeeting,
  getMeeting,
  listAgendaRelationCandidates,
  listMeetings,
  removeAgendaRelation,
  reorderAgenda,
  updateAgendaItem,
  updateMeeting,
} from "../src/services/meetings";
import { getDecision } from "../src/services/decisions";
import { createTask, deleteTask, getTask } from "../src/services/tasks";
import { removeMember } from "../src/services/team";
import { addMember, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let wsId: string;
let anna: AuthContext;
let max: AuthContext;

const times = (date = "2026-11-20", startTime = "10:00", endTime = "11:00") => ({ date, startTime, endTime });
const meeting = (c: AuthContext, input: Partial<CreateMeetingInput> = {}) =>
  createMeeting(c, createMeetingSchema.parse({ title: "Weekly Sync", times: times(), ...input }));
const item = (c: AuthContext, meetingId: string, input: Record<string, unknown> = {}) =>
  createAgendaItem(c, createAgendaItemSchema.parse({ meetingId, title: "Pilot Festung Hohensalzburg", ...input }));
const patchItem = (c: AuthContext, id: string, version: number, patch: Record<string, unknown>) =>
  updateAgendaItem(c, updateAgendaItemSchema.parse({ id, version, patch }));

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId)).ctx;
  max = (await makeMemberCtx(wsId)).ctx;
});

describe("meetings: plan", () => {
  it("stores times as instants in the team's time zone (winter and summer)", async () => {
    const winter = await meeting(anna, { times: times("2026-11-20", "14:00", "15:30") });
    expect(winter).toMatchObject({ startsAt: "2026-11-20T13:00:00.000Z", endsAt: "2026-11-20T14:30:00.000Z" });
    const summer = await meeting(anna, { times: times("2026-07-01", "09:00", "09:30") });
    expect(summer).toMatchObject({ startsAt: "2026-07-01T07:00:00.000Z", endsAt: "2026-07-01T07:30:00.000Z" });
  });

  it("requires a title and an end after the start", () => {
    expect(() => createMeetingSchema.parse({ title: "  ", times: times() })).toThrow();
    expect(() => createMeetingSchema.parse({ title: "Sync", times: times("2026-11-20", "11:00", "11:00") })).toThrow(
      /Endzeit/,
    );
    expect(() => createMeetingSchema.parse({ title: "Sync", times: times("2026-11-20", "11:00", "10:00") })).toThrow();
    expect(() => createMeetingSchema.parse({ title: "Sync", times: { ...times(), date: "2026-02-30" } })).toThrow();
    expect(() => createMeetingSchema.parse({ title: "Sync", times: times(), meetingUrl: "javascript:alert(1)" })).toThrow();
  });

  it("participants: active members only, duplicates collapse", async () => {
    const m = await meeting(anna, { participantIds: [anna.userId, max.userId, max.userId] });
    expect(m.participantIds.sort()).toEqual([anna.userId, max.userId].sort());

    const stranger = await makeUser();
    await expect(meeting(anna, { participantIds: [stranger.id] })).rejects.toMatchObject({ code: "VALIDATION" });
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    await expect(meeting(anna, { participantIds: [removed.id] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("create is idempotent with a client id", async () => {
    const id = randomUUID();
    const a = await meeting(anna, { id });
    const b = await meeting(anna, { id });
    expect(b.id).toBe(a.id);
    expect(await listMeetings(anna)).toHaveLength(1);
    await expect(meeting(max, { id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lists with participants and agenda counts; every member sees all meetings", async () => {
    const m = await meeting(anna, { participantIds: [anna.userId] });
    const a = await item(max, m.id);
    await item(max, m.id, { title: "Pricing-Modell" });
    await patchItem(anna, a.id, a.version, { status: "discussed" });
    const [row] = await listMeetings(max);
    expect(row).toMatchObject({ id: m.id, agendaCount: 2, discussedCount: 1, participantIds: [anna.userId] });
  });

  it("edits apply partially and bump the version; stale edits conflict", async () => {
    const m = await meeting(anna, { participantIds: [anna.userId], description: "Status" });
    const edited = await updateMeeting(
      max,
      updateMeetingSchema.parse({
        id: m.id,
        version: m.version,
        patch: { title: "Weekly Sync #2", participantIds: [max.userId], times: times("2026-11-21", "09:00", "09:45") },
      }),
    );
    expect(edited).toMatchObject({
      title: "Weekly Sync #2",
      description: "Status",
      participantIds: [max.userId],
      startsAt: "2026-11-21T08:00:00.000Z",
      endsAt: "2026-11-21T08:45:00.000Z",
      version: m.version + 1,
    });
    await expect(
      updateMeeting(anna, updateMeetingSchema.parse({ id: m.id, version: m.version, patch: { title: "Alt" } })),
    ).rejects.toMatchObject({ code: "CONFLICT", extra: { current: { title: "Weekly Sync #2" } } });

    // Removing the link.
    const withUrl = await updateMeeting(
      anna,
      updateMeetingSchema.parse({ id: m.id, version: edited.version, patch: { meetingUrl: "meet.google.com/abc-defg-hij" } }),
    );
    expect(withUrl.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    const noUrl = await updateMeeting(
      anna,
      updateMeetingSchema.parse({ id: m.id, version: withUrl.version, patch: { meetingUrl: null } }),
    );
    expect(noUrl.meetingUrl).toBeNull();
  });

  it("a former participant stays listed until removed from the meeting", async () => {
    const { user: leaver, ctx: leaverCtx } = await makeMemberCtx(wsId);
    const m = await meeting(anna, { participantIds: [anna.userId, leaverCtx.userId] });
    const admin = (await makeMemberCtx(wsId, "admin")).ctx;
    await removeMember(admin, leaver.id);
    const { meeting: after } = await getMeeting(anna, m.id);
    expect(after.participantIds).toContain(leaver.id);
    // Keeping them while editing is allowed; adding them again after removal is not.
    const kept = await updateMeeting(
      anna,
      updateMeetingSchema.parse({ id: m.id, version: after.version, patch: { participantIds: [anna.userId, leaver.id] } }),
    );
    expect(kept.participantIds).toContain(leaver.id);
  });

  it("delete removes the agenda but keeps linked issues and decisions", async () => {
    const project = await makeProject(wsId);
    const m = await meeting(anna);
    const a = await item(anna, m.id);
    const { task } = await createIssueFromAgendaItem(
      anna,
      createIssueFromAgendaSchema.parse({ itemId: a.id, projectId: project.id, title: a.title }),
    );
    await deleteMeeting(max, m.id);
    await expect(getMeeting(anna, m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getTask(anna, task.id)).title).toBe(a.title);
    await expect(deleteMeeting(max, m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("foreign workspaces behave like missing meetings", async () => {
    const m = await meeting(anna);
    const other = (await makeMemberCtx((await makeWorkspace("Fremd")).id)).ctx;
    await expect(getMeeting(other, m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(item(other, m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteMeeting(other, m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMeetings(other)).toHaveLength(0);
  });
});

describe("meetings: shared agenda", () => {
  it("points are appended in order, record the creator and keep their order on reload", async () => {
    const m = await meeting(anna);
    const a = await item(anna, m.id, { title: "Pilot Festung Hohensalzburg", description: "Nächste Schritte und Zeitplan abstimmen", assignedTo: max.userId });
    const b = await item(max, m.id, { title: "Pricing-Modell" });
    expect(a).toMatchObject({ createdBy: anna.userId, assignedTo: max.userId, status: "open", outcome: "" });
    const { agenda } = await getMeeting(max, m.id);
    expect(agenda.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(agenda[1].createdBy).toBe(max.userId);
  });

  it("everyone can edit, mark as discussed and document the outcome", async () => {
    const m = await meeting(anna);
    const a = await item(anna, m.id, { title: "Pricing-Modell" });
    const done = await patchItem(max, a.id, a.version, {
      status: "discussed",
      outcome: "Wir starten mit drei SaaS-Paketen. Die konkreten Preise werden nächste Woche festgelegt.",
    });
    expect(done).toMatchObject({ status: "discussed", version: a.version + 1 });
    expect((await getMeeting(anna, m.id)).agenda[0].outcome).toMatch(/drei SaaS-Paketen/);
  });

  it("responsible person must be an active member", async () => {
    const m = await meeting(anna);
    const stranger = await makeUser();
    await expect(item(anna, m.id, { assignedTo: stranger.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const a = await item(anna, m.id);
    await expect(patchItem(anna, a.id, a.version, { assignedTo: stranger.id })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await patchItem(anna, a.id, a.version, { assignedTo: max.userId })).assignedTo).toBe(max.userId);
  });

  it("concurrent edits: stale text is rejected, status and assignment always apply", async () => {
    const m = await meeting(anna);
    const a = await item(anna, m.id);
    // Max documents the outcome first.
    const byMax = await patchItem(max, a.id, a.version, { outcome: "Termin am 3. Dezember." });
    // Anna still has the old version open: her text edit must not overwrite Max's.
    await expect(patchItem(anna, a.id, a.version, { outcome: "Noch offen." })).rejects.toMatchObject({
      code: "CONFLICT",
      extra: { current: { outcome: "Termin am 3. Dezember." } },
    });
    // Toggling the status from the stale view is fine.
    const toggled = await patchItem(anna, a.id, a.version, { status: "discussed" });
    expect(toggled).toMatchObject({ status: "discussed", outcome: "Termin am 3. Dezember.", version: byMax.version + 1 });
    // A no-op patch does not bump the version.
    expect((await patchItem(anna, a.id, a.version, { title: a.title })).version).toBe(toggled.version);
  });

  it("reorder: stored order survives, unknown ids are ignored and new points are kept", async () => {
    const m = await meeting(anna);
    const [a, b, c] = [await item(anna, m.id, { title: "A" }), await item(anna, m.id, { title: "B" }), await item(anna, m.id, { title: "C" })];
    await reorderAgenda(max, reorderAgendaSchema.parse({ meetingId: m.id, ids: [c.id, a.id, b.id] }));
    expect((await getMeeting(anna, m.id)).agenda.map((i) => i.title)).toEqual(["C", "A", "B"]);

    // Anna dragged from a stale list (without D, plus a foreign id): D stays, at the end.
    const d = await item(max, m.id, { title: "D" });
    await reorderAgenda(anna, reorderAgendaSchema.parse({ meetingId: m.id, ids: [b.id, c.id, a.id, randomUUID()] }));
    expect((await getMeeting(anna, m.id)).agenda.map((i) => i.title)).toEqual(["B", "C", "A", "D"]);
    expect(d.title).toBe("D");
  });

  it("delete removes a point; repeating it reports not found", async () => {
    const m = await meeting(anna);
    const a = await item(anna, m.id);
    await deleteAgendaItem(max, a.id);
    expect((await getMeeting(anna, m.id)).agenda).toHaveLength(0);
    await expect(deleteAgendaItem(max, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("idempotent create with a client id", async () => {
    const m = await meeting(anna);
    const id = randomUUID();
    await item(anna, m.id, { id });
    await item(anna, m.id, { id });
    expect((await getMeeting(anna, m.id)).agenda).toHaveLength(1);
  });
});

describe("meetings: issues and decisions", () => {
  it("creates an issue with the regular task creation and links it", async () => {
    const project = await makeProject(wsId);
    const m = await meeting(anna);
    const a = await item(anna, m.id, { title: "Implement new pricing page", assignedTo: max.userId });
    const taskId = randomUUID();
    const input = createIssueFromAgendaSchema.parse({
      itemId: a.id,
      id: taskId,
      projectId: project.id,
      title: a.title,
      description: "Drei Pakete",
      assigneeId: max.userId,
    });
    const { item: linked, task } = await createIssueFromAgendaItem(anna, input);
    expect(task).toMatchObject({ id: taskId, projectId: project.id, title: a.title, status: "open", assigneeId: max.userId });
    expect(task.number).toBeGreaterThan(0);
    expect(linked.relations).toEqual([
      expect.objectContaining({ kind: "issue", targetId: taskId, number: task.number, projectId: project.id }),
    ]);
    // Retry: no second issue.
    const again = await createIssueFromAgendaItem(anna, input);
    expect(again.task.id).toBe(taskId);
    expect(again.item.relations).toHaveLength(1);
  });

  it("refuses archived projects (same rule as everywhere)", async () => {
    const archived = await makeProject(wsId, "Alt", true);
    const m = await meeting(anna);
    const a = await item(anna, m.id);
    await expect(
      createIssueFromAgendaItem(anna, createIssueFromAgendaSchema.parse({ itemId: a.id, projectId: archived.id, title: "x" })),
    ).rejects.toMatchObject({ code: "ARCHIVED" });
  });

  it("links existing issues and decisions, finds candidates and unlinks", async () => {
    const project = await makeProject(wsId);
    const task = await createTask(anna, createTaskSchema.parse({ projectId: project.id, title: "Landing Page" }));
    const m = await meeting(anna);
    const a = await item(anna, m.id);

    const byNumber = await listAgendaRelationCandidates(
      max,
      agendaRelationCandidatesSchema.parse({ itemId: a.id, kind: "issue", query: `#${task.number}` }),
    );
    expect(byNumber[0]).toMatchObject({ targetId: task.id, number: task.number });

    const linked = await addAgendaRelation(max, addAgendaRelationSchema.parse({ itemId: a.id, kind: "issue", targetId: task.id }));
    expect(linked.relations).toHaveLength(1);
    // Twice is a no-op; linked items are no candidates anymore.
    expect((await addAgendaRelation(max, addAgendaRelationSchema.parse({ itemId: a.id, kind: "issue", targetId: task.id }))).relations).toHaveLength(1);
    expect(
      await listAgendaRelationCandidates(max, agendaRelationCandidatesSchema.parse({ itemId: a.id, kind: "issue", query: "Landing" })),
    ).toHaveLength(0);

    const { item: withDecision, decisionId } = await createDecisionFromAgendaItem(
      anna,
      createDecisionFromAgendaSchema.parse({ itemId: a.id, title: "Pricing: drei Pakete", description: "Aus dem Meeting" }),
    );
    expect(withDecision.relations.map((r) => r.kind)).toEqual(["issue", "decision"]);
    expect((await getDecision(anna, decisionId)).decision).toMatchObject({ status: "open", title: "Pricing: drei Pakete" });

    const unlinked = await removeAgendaRelation(anna, withDecision.relations[1].id);
    expect(unlinked.relations.map((r) => r.kind)).toEqual(["issue"]);
    // Deleting the issue removes the link, not the agenda point.
    await deleteTask(anna, task.id);
    expect((await getMeeting(anna, m.id)).agenda[0].relations).toHaveLength(0);
  });

  it("cannot link issues of another workspace", async () => {
    const otherWs = await makeWorkspace("Fremd");
    const other = (await makeMemberCtx(otherWs.id)).ctx;
    const foreignTask = await createTask(other, createTaskSchema.parse({ projectId: (await makeProject(otherWs.id)).id, title: "Geheim" }));
    const m = await meeting(anna);
    const a = await item(anna, m.id);
    await expect(
      addAgendaRelation(anna, addAgendaRelationSchema.parse({ itemId: a.id, kind: "issue", targetId: foreignTask.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("meetings: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("active members can read, others cannot; nobody writes through the Data API", async () => {
    const m = await meeting(anna, { participantIds: [anna.userId] });
    await item(anna, m.id);
    const stranger = await makeUser();
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");

    for (const table of ["meetings", "meeting_participants", "meeting_agenda_items"]) {
      const q = (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select workspace_id from ${tx(table)} where workspace_id = ${wsId}`;
      expect(await asUser(max.userId, q)).toHaveLength(1);
      expect(await asUser(stranger.id, q)).toHaveLength(0);
      expect(await asUser(removed.id, q)).toHaveLength(0);
    }
    await expect(asUser(null, (tx) => tx`select id from meetings`)).rejects.toThrow(/permission denied/);
    await expect(asUser(anna.userId, (tx) => tx`update meetings set title = 'x' where id = ${m.id}`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(anna.userId, (tx) => tx`delete from meeting_agenda_items`)).rejects.toThrow(/permission denied/);
  });
});
