import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import {
  addDecisionRelationSchema,
  createDecisionLinkSchema,
  createDecisionSchema,
  listDecisionsSchema,
  relationCandidatesSchema,
  supersedeDecisionSchema,
  updateDecisionLinkSchema,
  updateDecisionSchema,
  teamToday,
  type DecisionListQuery,
} from "@vistoo/domain/decisions";
import { createIdeaSchema } from "@vistoo/domain/ideas";
import { createTaskSchema } from "@vistoo/domain/validation";
import {
  addDecisionRelation,
  createDecision,
  createDecisionLink,
  deleteDecision,
  deleteDecisionLink,
  getDecision,
  listDecisions,
  listRelationCandidates,
  listSupersedeCandidates,
  removeDecisionRelation,
  supersedeDecision,
  toPrefixQuery,
  updateDecision,
  updateDecisionLink,
} from "../src/services/decisions";
import { createIdea, deleteIdea } from "../src/services/ideas";
import { createTask, deleteTask } from "../src/services/tasks";
import { getDb } from "../src/db";
import { addMember, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let wsId: string;
let anna: AuthContext;
let max: AuthContext;

const add = (c: AuthContext, input: Record<string, unknown>) => createDecision(c, createDecisionSchema.parse(input));
const patch = (c: AuthContext, id: string, p: Record<string, unknown>) =>
  updateDecision(c, updateDecisionSchema.parse({ id, patch: p }));
const list = (c: AuthContext, q: DecisionListQuery = {}) => listDecisions(c, listDecisionsSchema.parse(q));
const titles = async (c: AuthContext, q: DecisionListQuery = {}) => (await list(c, q)).map((d) => d.title);

/** A decided decision ("Railway"), as the team would document it. */
async function decided(c: AuthContext, title = "Welchen Hosting-Anbieter verwenden wir?") {
  const d = await add(c, { title, description: "Skalierbares Hosting für das Backend." });
  await patch(c, d.id, {
    optionsConsidered: "Railway, Hetzner, AWS",
    outcome: "Railway",
    reasoning: "Einfache Deployments und geringer Wartungsaufwand.",
    status: "decided",
  });
  return d;
}

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId)).ctx;
  max = (await makeMemberCtx(wsId)).ctx;
});

describe("decisions: create and document later", () => {
  it("only the title is required; each type starts in its first status", async () => {
    const d = await add(anna, { title: "Pricing-Modell für Vistoo" });
    const e = await add(anna, { type: "experiment", title: "LangChain für den KI-Assistenten evaluieren" });
    expect(d).toMatchObject({ type: "decision", status: "open", createdBy: anna.userId, assigneeId: null, concludedOn: null });
    expect(e).toMatchObject({ type: "experiment", status: "planned" });
    expect(() => createDecisionSchema.parse({ title: "   " })).toThrow();

    // Details are added later, by anyone in the workspace.
    const { decision } = await patch(max, e.id, {
      objective: "Vereinfacht das Framework die Entwicklung?",
      testDescription: "Tool Calling, Kontextverwaltung, Antwortzeiten",
      status: "testing",
      assigneeId: max.userId,
    });
    expect(decision).toMatchObject({ status: "testing", assigneeId: max.userId, objective: "Vereinfacht das Framework die Entwicklung?" });
  });

  it("idempotent create with a client id", async () => {
    const id = randomUUID();
    await add(anna, { id, title: "x" });
    await add(anna, { id, title: "x" });
    expect(await list(anna)).toHaveLength(1);
    await expect(add(max, { id, title: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("statuses must belong to the type; switching type maps the stage", async () => {
    const d = await add(anna, { title: "AR-Objekterkennung" });
    await expect(patch(anna, d.id, { status: "testing" })).rejects.toMatchObject({ code: "VALIDATION" });
    await patch(anna, d.id, { status: "in_discussion" });
    const { decision } = await patch(anna, d.id, { type: "experiment" });
    expect(decision).toMatchObject({ type: "experiment", status: "testing" });
  });

  it("the assignee must be an active member", async () => {
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    await expect(add(anna, { title: "x", assigneeId: removed.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("decisions: concluding", () => {
  it("'decided' requires the final decision and reasoning, and sets the decision day", async () => {
    const d = await add(anna, { title: "Hosting" });
    await expect(patch(anna, d.id, { status: "decided" })).rejects.toMatchObject({
      code: "VALIDATION",
      extra: { fieldErrors: { outcome: expect.any(String), reasoning: expect.any(String) } },
    });
    await expect(patch(anna, d.id, { status: "decided", outcome: "Railway", reasoning: "   " })).rejects.toMatchObject({
      extra: { fieldErrors: { reasoning: expect.any(String) } },
    });
    // Nothing was stored by the failed attempts.
    expect((await getDecision(anna, d.id)).decision).toMatchObject({ status: "open", outcome: "" });

    const { decision, history } = await patch(anna, d.id, { status: "decided", outcome: "Railway", reasoning: "Einfach." });
    expect(decision.status).toBe("decided");
    expect(decision.concludedOn).toBe(teamToday());
    expect(history).toMatchObject([{ kind: "concluded", actorId: anna.userId, details: { toStatus: "decided" } }]);

    // Documented afterwards: the day can be adjusted.
    const later = await patch(anna, d.id, { concludedOn: "2026-03-01" });
    expect(later.decision.concludedOn).toBe("2026-03-01");
  });

  it("experiments only need a result for adopted/rejected/inconclusive", async () => {
    const e = await add(anna, { type: "experiment", title: "LangChain evaluieren" });
    for (const status of ["adopted", "rejected", "inconclusive"]) {
      await expect(patch(anna, e.id, { status })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    const { decision } = await patch(anna, e.id, {
      status: "rejected",
      results: "Geeignet, aber zusätzlicher Aufwand.",
      concludedOn: "2026-10-01",
    });
    expect(decision).toMatchObject({ status: "rejected", concludedOn: "2026-10-01" });
    // The overview previews the experiment's result.
    const row = (await list(anna, { type: "experiment" })).find((r) => r.id === e.id);
    expect(row?.outcomePreview).toBe("Geeignet, aber zusätzlicher Aufwand.");
  });

  it("the database rejects incomplete concluded entries even without the service", async () => {
    const d = await add(anna, { title: "x" });
    await expect(
      getDb().execute(
        // Bypasses the service on purpose (defence in depth).
        (await import("drizzle-orm")).sql`update decisions set status = 'decided', concluded_on = current_date where id = ${d.id}`,
      ),
    ).rejects.toThrow();
  });

  it("reopening clears the day and is recorded", async () => {
    const d = await decided(anna);
    const { decision, history } = await patch(max, d.id, { status: "in_discussion" });
    expect(decision).toMatchObject({ status: "in_discussion", concludedOn: null, outcome: "Railway" });
    expect(history[0]).toMatchObject({ kind: "reopened", actorId: max.userId, details: { fromStatus: "decided", toStatus: "in_discussion" } });
  });
});

describe("decisions: traceability", () => {
  it("edits of concluded entries keep who, when, which fields and the previous values", async () => {
    const d = await decided(anna);
    const { history } = await patch(max, d.id, { reasoning: "Einfache Deployments, geringer Wartungsaufwand.", assigneeId: max.userId });
    expect(history[0]).toMatchObject({
      kind: "edited",
      actorId: max.userId,
      details: { fields: ["reasoning"], previous: { reasoning: "Einfache Deployments und geringer Wartungsaufwand." } },
    });
    expect(history).toHaveLength(2);

    // Saving without a real change writes nothing.
    const again = await patch(max, d.id, { reasoning: "Einfache Deployments, geringer Wartungsaufwand." });
    expect(again.history).toHaveLength(2);

    // Edits before concluding are not recorded.
    const open = await add(anna, { title: "Offen" });
    expect((await patch(anna, open.id, { description: "Kontext" })).history).toEqual([]);
  });

  it("history entries are immutable", async () => {
    const d = await decided(anna);
    const { sql } = await import("drizzle-orm");
    const immutable = { cause: expect.objectContaining({ message: expect.stringMatching(/cannot be changed/) }) };
    await expect(getDb().execute(sql`update decision_history set details = '{}' where decision_id = ${d.id}`)).rejects.toMatchObject(
      immutable,
    );
    await expect(getDb().execute(sql`delete from decision_history where decision_id = ${d.id}`)).rejects.toMatchObject(immutable);
  });

  it("supersede with a new decision: the old one stays intact and points to the new one", async () => {
    const old = await decided(anna);
    await expect(patch(anna, old.id, { status: "superseded" })).rejects.toMatchObject({ code: "VALIDATION" });

    const newId = randomUUID();
    const input = supersedeDecisionSchema.parse({ id: old.id, newTitle: "Wechsel auf Hetzner?", newId });
    const { decision, successor } = await supersedeDecision(max, input);
    expect(successor).toMatchObject({ id: newId, type: "decision", status: "open", title: "Wechsel auf Hetzner?" });
    expect(decision.decision).toMatchObject({
      status: "superseded",
      outcome: "Railway",
      reasoning: "Einfache Deployments und geringer Wartungsaufwand.",
      supersededBy: { id: newId, title: "Wechsel auf Hetzner?" },
    });
    expect(decision.history[0]).toMatchObject({ kind: "superseded", actorId: max.userId, details: { supersededBy: newId } });
    // The new decision knows its predecessor.
    expect((await getDecision(anna, newId)).decision.supersedes).toEqual([{ id: old.id, title: old.title, status: "superseded" }]);
    // Retrying the same request changes nothing.
    await supersedeDecision(max, input);
    expect(await list(anna)).toHaveLength(2);
  });

  it("supersede with an existing decision; only decided decisions, no self-reference", async () => {
    const old = await decided(anna);
    const next = await decided(anna, "Hetzner statt Railway");
    const experiment = await add(anna, { type: "experiment", title: "Hetzner testen" });
    const open = await add(anna, { title: "Noch offen" });

    expect((await listSupersedeCandidates(anna, old.id)).map((c) => c.id).sort()).toEqual([next.id, open.id].sort());
    await expect(supersedeDecision(anna, supersedeDecisionSchema.parse({ id: open.id, successorId: next.id }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(supersedeDecision(anna, supersedeDecisionSchema.parse({ id: old.id, successorId: old.id }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      supersedeDecision(anna, supersedeDecisionSchema.parse({ id: old.id, successorId: experiment.id })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const { decision } = await supersedeDecision(anna, supersedeDecisionSchema.parse({ id: old.id, successorId: next.id }));
    expect(decision.decision.supersededBy?.id).toBe(next.id);
    // A replaced decision cannot replace another one (no cycles).
    await expect(supersedeDecision(anna, supersedeDecisionSchema.parse({ id: next.id, successorId: old.id }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("restoring a superseded decision, and deleting the successor, make it current again", async () => {
    const old = await decided(anna);
    const { successor } = await supersedeDecision(anna, supersedeDecisionSchema.parse({ id: old.id, newTitle: "Neu" }));
    const restored = await patch(anna, old.id, { status: "decided" });
    expect(restored.decision).toMatchObject({ status: "decided", supersededBy: null });
    expect(restored.history[0]).toMatchObject({ kind: "reopened", details: { fromStatus: "superseded", toStatus: "decided" } });

    await supersedeDecision(anna, supersedeDecisionSchema.parse({ id: old.id, successorId: successor.id }));
    const res = await deleteDecision(max, successor.id);
    expect(res.restored).toEqual([old.id]);
    const after = await getDecision(anna, old.id);
    expect(after.decision).toMatchObject({ status: "decided", supersededBy: null, outcome: "Railway" });
    expect(after.history[0]).toMatchObject({ kind: "reopened", actorId: max.userId, details: { reason: "successor_deleted" } });
  });
});

describe("decisions: search, filter, sort", () => {
  it("full text over title, description, results, decision and reasoning (prefix, case-insensitive)", async () => {
    const hosting = await decided(anna);
    const lc = await add(anna, { type: "experiment", title: "Framework für den KI-Assistenten" });
    await patch(anna, lc.id, { results: "LangChain verursacht zusätzlichen Aufwand." });
    const ar = await add(max, { type: "experiment", title: "AR Navigation", description: "Objekterkennung auf Android" });

    expect(await titles(anna, { query: "langchain" })).toEqual([lc.title]);
    expect(await titles(anna, { query: "LANG" })).toEqual([lc.title]);
    expect(await titles(anna, { query: "railway" })).toEqual([hosting.title]); // final decision
    expect(await titles(anna, { query: "wartungsaufwand" })).toEqual([hosting.title]); // reasoning
    expect(await titles(anna, { query: "hosting" })).toEqual([hosting.title]); // title
    expect(await titles(anna, { query: "ar navigation" })).toEqual([ar.title]);
    expect(await titles(anna, { query: "android" })).toEqual([ar.title]); // description
    expect(await titles(anna, { query: "  " })).toHaveLength(3);
    // Operators in the input are just text.
    expect(await titles(anna, { query: "a & | ! :* ( ' \\" })).toEqual(expect.any(Array));
    expect(toPrefixQuery("Offline-Navigation (v2)!")).toBe("offline:* & navigation:* & v2:*");
  });

  it("filters by type, status and assignee; sorts by update (default) or creation", async () => {
    const a = await add(anna, { title: "A", assigneeId: max.userId });
    const b = await add(anna, { type: "experiment", title: "B" });
    const c = await add(anna, { title: "C" });
    await patch(anna, a.id, { status: "in_discussion" });
    // Deterministic times (inserts in quick succession can share a timestamp).
    const { sql } = await import("drizzle-orm");
    for (const [id, created, updated] of [
      [a.id, "2026-01-01", "2026-03-01"],
      [b.id, "2026-01-02", "2026-01-02"],
      [c.id, "2026-01-03", "2026-01-03"],
    ]) {
      await getDb().execute(sql`update decisions set created_at = ${created}::timestamptz, updated_at = ${updated}::timestamptz where id = ${id}`);
    }

    expect(await titles(anna)).toEqual(["A", "C", "B"]);
    expect(await titles(anna, { sort: "created" })).toEqual(["C", "B", "A"]);
    expect(await titles(anna, { sort: "created_asc" })).toEqual(["A", "B", "C"]);
    expect(await titles(anna, { type: "experiment" })).toEqual(["B"]);
    expect(await titles(anna, { status: "in_discussion" })).toEqual(["A"]);
    expect(await titles(anna, { assigneeId: max.userId })).toEqual(["A"]);
    expect(await titles(anna, { assigneeId: "none", sort: "created_asc" })).toEqual(["B", "C"]);
  });

  it("the overview carries a short outcome preview, not the long texts", async () => {
    await decided(anna);
    const [row] = await list(anna);
    expect(row.outcomePreview).toBe("Railway");
    expect(row).not.toHaveProperty("reasoning");
  });
});

describe("decisions: links to issues, ideas and the web", () => {
  it("link existing issues and ideas, open them, remove them; deleted targets disappear", async () => {
    const projectId = (await makeProject(wsId)).id;
    const task = await createTask(anna, createTaskSchema.parse({ projectId, title: "Backend auf Hetzner migrieren" }));
    const idea = await createIdea(anna, createIdeaSchema.parse({ title: "KI-basierte Navigation" }));
    const d = await decided(anna);

    const candidates = await listRelationCandidates(anna, relationCandidatesSchema.parse({ decisionId: d.id, query: "hetzner" }));
    expect(candidates).toEqual([
      { kind: "issue", targetId: task.id, title: task.title, status: "open", projectId, number: expect.any(Number) },
    ]);
    const byNumber = await listRelationCandidates(
      anna,
      relationCandidatesSchema.parse({ decisionId: d.id, query: `#${candidates[0].number}` }),
    );
    expect(byNumber[0]).toMatchObject({ kind: "issue", targetId: task.id });

    await addDecisionRelation(anna, addDecisionRelationSchema.parse({ decisionId: d.id, kind: "issue", targetId: task.id }));
    const relations = await addDecisionRelation(max, addDecisionRelationSchema.parse({ decisionId: d.id, kind: "idea", targetId: idea.id }));
    expect(relations.map((r) => [r.kind, r.title, r.projectId, r.number])).toEqual([
      ["issue", task.title, projectId, candidates[0].number],
      ["idea", idea.title, null, null],
    ]);
    // Linking twice is a no-op; linked items are no longer offered.
    await addDecisionRelation(max, addDecisionRelationSchema.parse({ decisionId: d.id, kind: "idea", targetId: idea.id }));
    expect((await getDecision(anna, d.id)).relations).toHaveLength(2);
    expect(await listRelationCandidates(anna, relationCandidatesSchema.parse({ decisionId: d.id, query: "" }))).toEqual([]);

    await removeDecisionRelation(anna, relations[1].id);
    expect((await getDecision(anna, d.id)).relations.map((r) => r.kind)).toEqual(["issue"]);
    await deleteTask(anna, task.id);
    expect((await getDecision(anna, d.id)).relations).toEqual([]);
    await deleteIdea(anna, idea.id);
  });

  it("issues and ideas of another workspace cannot be linked", async () => {
    const otherWs = (await makeWorkspace("Andere")).id;
    const stranger = (await makeMemberCtx(otherWs)).ctx;
    const foreignIdea = await createIdea(stranger, createIdeaSchema.parse({ title: "Fremd" }));
    const foreignTask = await createTask(stranger, createTaskSchema.parse({ projectId: (await makeProject(otherWs)).id, title: "Fremd" }));
    const d = await add(anna, { title: "x" });
    for (const [kind, targetId] of [["idea", foreignIdea.id], ["issue", foreignTask.id]] as const) {
      await expect(addDecisionRelation(anna, addDecisionRelationSchema.parse({ decisionId: d.id, kind, targetId }))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(await listRelationCandidates(anna, relationCandidatesSchema.parse({ decisionId: d.id, query: "fremd" }))).toEqual([]);
  });

  it("external links: add with optional name, edit, remove; only http(s)", async () => {
    const d = await add(anna, { title: "x" });
    const link = await createDecisionLink(
      anna,
      createDecisionLinkSchema.parse({ decisionId: d.id, url: "github.com/vistoo/app/pull/12", title: "" }),
    );
    expect(link).toMatchObject({ url: "https://github.com/vistoo/app/pull/12", title: null });
    const edited = await updateDecisionLink(max, updateDecisionLinkSchema.parse({ id: link.id, url: link.url, title: "Benchmark-PR" }));
    expect(edited.title).toBe("Benchmark-PR");
    expect((await getDecision(anna, d.id)).links).toHaveLength(1);
    expect(() => createDecisionLinkSchema.parse({ decisionId: d.id, url: "javascript:alert(1)" })).toThrow();
    await deleteDecisionLink(max, link.id);
    expect((await getDecision(anna, d.id)).links).toEqual([]);
  });

  it("deleting an entry removes its links, relations and history", async () => {
    const d = await decided(anna);
    await createDecisionLink(anna, createDecisionLinkSchema.parse({ decisionId: d.id, url: "https://example.com" }));
    await deleteDecision(anna, d.id);
    await expect(getDecision(anna, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDecision(anna, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("decisions: workspace boundaries", () => {
  it("entries of another workspace behave like missing ones", async () => {
    const d = await decided(anna);
    const link = await createDecisionLink(anna, createDecisionLinkSchema.parse({ decisionId: d.id, url: "https://example.com" }));
    const other = (await makeMemberCtx((await makeWorkspace("Andere")).id)).ctx;
    const mine = await add(other, { title: "Eigene" });

    expect(await list(other)).toHaveLength(1);
    expect(await titles(other, { query: "railway" })).toEqual([]);
    await expect(getDecision(other, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(patch(other, d.id, { title: "gekapert" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDecision(other, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDecisionLink(other, link.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createDecisionLink(other, createDecisionLinkSchema.parse({ decisionId: d.id, url: "https://example.com" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Cross-workspace supersede in either direction is impossible.
    await expect(supersedeDecision(other, supersedeDecisionSchema.parse({ id: d.id, newTitle: "x" }))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await patch(other, mine.id, { outcome: "y", reasoning: "z", status: "decided" });
    await expect(supersedeDecision(other, supersedeDecisionSchema.parse({ id: mine.id, successorId: d.id }))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("decisions: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("active members can read, others cannot; nobody writes through the Data API", async () => {
    const d = await decided(anna);
    await createDecisionLink(anna, createDecisionLinkSchema.parse({ decisionId: d.id, url: "https://example.com" }));
    const stranger = await makeUser();
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");

    for (const table of ["decisions", "decision_links", "decision_history"]) {
      const q = (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select id from ${tx(table)} where workspace_id = ${wsId}`;
      expect(await asUser(max.userId, q)).toHaveLength(1);
      expect(await asUser(stranger.id, q)).toHaveLength(0);
      expect(await asUser(removed.id, q)).toHaveLength(0);
    }
    await expect(asUser(null, (tx) => tx`select id from decisions`)).rejects.toThrow(/permission denied/);
    await expect(asUser(anna.userId, (tx) => tx`update decisions set title = 'x' where id = ${d.id}`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(anna.userId, (tx) => tx`delete from decision_history`)).rejects.toThrow(/permission denied/);
  });
});
