import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { tasks } from "@vistoo/database/schema";
import {
  createMilestone,
  deleteMilestone,
  getMilestone,
  listMilestones,
  setMilestoneCompleted,
  updateMilestone,
} from "../src/services/milestones";
import { setProjectArchived } from "../src/services/projects";
import { createTask, listTasks, setTaskStatus, updateTask } from "../src/services/tasks";
import { createMilestoneSchema, createTaskSchema } from "@vistoo/domain/validation";
import { makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let ctx: AuthContext;
let wsId: string;
let projectId: string;

const milestone = (over: Partial<{ name: string; dueDate: string | null; id: string }> = {}) =>
  createMilestone(ctx, createMilestoneSchema.parse({ name: "Launch v1", ...over }));

const task = (over: Record<string, unknown> = {}, as = ctx) =>
  createTask(as, createTaskSchema.parse({ projectId, title: "Aufgabe", ...over }));

beforeEach(async () => {
  const ws = await makeWorkspace();
  wsId = ws.id;
  ctx = (await makeMemberCtx(ws.id)).ctx;
  projectId = (await makeProject(ws.id)).id;
});

describe("milestones", () => {
  it("tasks of different projects can be attached, counted and listed per milestone", async () => {
    const m = await milestone({ dueDate: "2026-12-01" });
    const other = await makeProject(wsId, "App");
    const a = await task({ milestoneId: m.id });
    await task({ milestoneId: m.id, projectId: other.id });
    await task();
    await setTaskStatus(ctx, { id: a.id, status: "done" });

    const [listed] = await listMilestones(ctx);
    expect(listed).toMatchObject({ id: m.id, name: "Launch v1", dueDate: "2026-12-01", total: 2, done: 1, completed: false });
    expect((await listTasks(ctx, { milestoneId: m.id })).map((t) => t.projectId).sort()).toEqual(
      [projectId, other.id].sort(),
    );

    // Archived projects are hidden from milestone lists and counts.
    await setProjectArchived(ctx, { id: other.id, archived: true });
    expect((await getMilestone(ctx, m.id)).total).toBe(1);
    expect(await listTasks(ctx, { milestoneId: m.id })).toHaveLength(1);
  });

  it("assigning and removing a milestone through a task update", async () => {
    const m = await milestone();
    const t = await task();
    const set = await updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { milestoneId: m.id } });
    expect(set.milestoneId).toBe(m.id);
    // Changing the project keeps the (workspace-wide) milestone.
    const other = await makeProject(wsId, "Anderes Projekt");
    const moved = await updateTask(ctx, { id: t.id, expectedVersion: set.version, patch: { projectId: other.id } });
    expect(moved.milestoneId).toBe(m.id);
    const cleared = await updateTask(ctx, { id: t.id, expectedVersion: moved.version, patch: { milestoneId: null } });
    expect(cleared.milestoneId).toBeNull();
  });

  it("rejects milestones of another workspace — in the service and in the database", async () => {
    const foreignWs = await makeWorkspace("Fremd");
    const foreign = (await makeMemberCtx(foreignWs.id)).ctx;
    const theirs = await createMilestone(foreign, createMilestoneSchema.parse({ name: "Geheim" }));

    await expect(task({ milestoneId: theirs.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const t = await task();
    await expect(
      updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { milestoneId: theirs.id } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getDb().update(tasks).set({ milestoneId: theirs.id }).where(eq(tasks.id, t.id))).rejects.toThrow();

    await expect(getMilestone(ctx, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateMilestone(ctx, { id: theirs.id, name: "X", description: "", dueDate: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(deleteMilestone(ctx, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMilestones(ctx)).toHaveLength(0);
  });

  it("edit, complete and reopen; completed milestones sort last", async () => {
    const first = await milestone({ name: "Beta", dueDate: "2026-11-20" });
    await milestone({ name: "Ohne Datum" });
    await milestone({ name: "Alpha", dueDate: "2026-11-10" });
    expect((await listMilestones(ctx)).map((m) => m.name)).toEqual(["Alpha", "Beta", "Ohne Datum"]);

    const edited = await updateMilestone(ctx, { id: first.id, name: "Beta 2", description: "Mit Shop", dueDate: null });
    expect(edited).toMatchObject({ name: "Beta 2", description: "Mit Shop", dueDate: null });

    await setMilestoneCompleted(ctx, { id: first.id, completed: true });
    expect((await listMilestones(ctx)).map((m) => [m.name, m.completed])).toEqual([
      ["Alpha", false],
      ["Ohne Datum", false],
      ["Beta 2", true],
    ]);
    expect((await setMilestoneCompleted(ctx, { id: first.id, completed: false })).completed).toBe(false);
  });

  it("deleting a milestone keeps its tasks, detaches them and bumps their version", async () => {
    const m = await milestone();
    const t = await task({ milestoneId: m.id });
    const result = await deleteMilestone(ctx, m.id);
    expect(result.detachedTasks).toBe(1);
    const after = (await listTasks(ctx)).find((x) => x.id === t.id);
    expect(after?.milestoneId).toBeNull();
    expect(after?.version).toBe(t.version + 1);
    expect(await listMilestones(ctx)).toHaveLength(0);
  });

  it("create is idempotent with a client id", async () => {
    const id = crypto.randomUUID();
    const a = await milestone({ id });
    const b = await milestone({ id });
    expect(b.id).toBe(a.id);
    expect(await listMilestones(ctx)).toHaveLength(1);
  });
});

describe("milestones: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("active members can read, others cannot; nobody writes through the Data API", async () => {
    await milestone();
    const stranger = await makeUser();
    const q = (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select id from milestones where workspace_id = ${wsId}`;
    expect(await asUser(ctx.userId, q)).toHaveLength(1);
    expect(await asUser(stranger.id, q)).toHaveLength(0);
    expect(await asUser(null, q).catch(() => [])).toHaveLength(0);
    await expect(asUser(ctx.userId, (tx) => tx`delete from milestones where workspace_id = ${wsId}`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
