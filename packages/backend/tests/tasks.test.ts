import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { tasks } from "@vistoo/database/schema";
import { getProject, setProjectArchived } from "../src/services/projects";
import { removeMember } from "../src/services/team";
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  setTaskAssignee,
  setTaskAssignees,
  setTaskChecklistItem,
  setTaskStatus,
  updateTask,
} from "../src/services/tasks";
import { createTaskSchema, updateTaskSchema } from "@vistoo/domain/validation";
import { makeMemberCtx, makeProject, makeUser, makeWorkspace, addMember } from "./support/fixtures";

let ctx: AuthContext;
let wsId: string;
let projectId: string;

const newTask = (over: Partial<Parameters<typeof createTask>[1]> = {}) =>
  createTask(ctx, {
    projectId,
    title: "Aufgabe",
    description: "",
    status: "open",
    milestoneId: null,
    assigneeId: null,
    startDate: null,
    endDate: null,
    ...over,
  });

beforeEach(async () => {
  const ws = await makeWorkspace();
  wsId = ws.id;
  ctx = (await makeMemberCtx(ws.id)).ctx;
  projectId = (await makeProject(ws.id)).id;
});

describe("removed groups (API v1 compatibility)", () => {
  it("older clients may still send groupId; it is ignored and always returned as null", async () => {
    const legacy = createTaskSchema.parse({ projectId, title: "Alt", groupId: "11111111-1111-4111-8111-111111111111" });
    expect("groupId" in legacy).toBe(false);
    const t = await newTask();
    expect(t.groupId).toBeNull();
    const patch = updateTaskSchema.parse({
      id: t.id,
      expectedVersion: t.version,
      patch: { title: "Neu", groupId: "11111111-1111-4111-8111-111111111111" },
    });
    const updated = await updateTask(ctx, patch);
    expect(updated.groupId).toBeNull();
    expect(updated.title).toBe("Neu");
  });

  it("projects report no groups", async () => {
    expect((await getProject(ctx, projectId)).groups).toEqual([]);
  });
});

describe("date ranges", () => {
  it("validation rejects end before start", () => {
    const r = createTaskSchema.safeParse({
      projectId,
      title: "x",
      startDate: "2026-11-10",
      endDate: "2026-11-09",
    });
    expect(r.success).toBe(false);
    expect(updateTaskSchema.safeParse({ id: projectId, expectedVersion: 1, patch: { startDate: "2026-02-30" } }).success).toBe(false);
  });

  it("service rejects a patch that makes the merged range invalid", async () => {
    const t = await newTask({ startDate: "2026-11-10", endDate: "2026-11-12" });
    await expect(
      updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { endDate: "2026-11-01" } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stores calendar days unchanged and allows one-day tasks", async () => {
    const t = await newTask({ startDate: "2026-03-29", endDate: "2026-03-29" });
    expect(t.startDate).toBe("2026-03-29");
    expect(t.endDate).toBe("2026-03-29");
  });

  it("database check constraint rejects invalid ranges", async () => {
    const t = await newTask();
    await expect(
      getDb().update(tasks).set({ startDate: "2026-05-02", endDate: "2026-05-01" }).where(eqId(t.id)),
    ).rejects.toThrow();
  });
});

describe("optimistic concurrency", () => {
  it("rejects an update based on a stale version and returns the current state", async () => {
    const t = await newTask({ title: "Original" });
    const first = await updateTask(ctx, { id: t.id, expectedVersion: 1, patch: { title: "Client A" } });
    expect(first.version).toBe(2);
    const err = await updateTask(ctx, { id: t.id, expectedVersion: 1, patch: { title: "Client B" } }).catch((e) => e);
    expect(err).toMatchObject({ code: "CONFLICT" });
    expect(err.extra.current).toMatchObject({ title: "Client A", version: 2 });
  });

  it("concurrent updates with the same version: exactly one wins", async () => {
    const t = await newTask();
    const results = await Promise.allSettled([
      updateTask(ctx, { id: t.id, expectedVersion: 1, patch: { title: "A" } }),
      updateTask(ctx, { id: t.id, expectedVersion: 1, patch: { title: "B" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
  });
});

describe("board ordering", () => {
  it("appends new tasks to the end of their column", async () => {
    const a = await newTask({ title: "A" });
    const b = await newTask({ title: "B" });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("moves between neighbours and across columns", async () => {
    const a = await newTask({ title: "A" });
    const b = await newTask({ title: "B" });
    const c = await newTask({ title: "C" });
    // C between A and B
    const movedC = await moveTask(ctx, { id: c.id, status: "open", afterId: a.id, beforeId: b.id });
    const order = (await listTasks(ctx)).filter((t) => t.status === "open").map((t) => t.title);
    expect(order).toEqual(["A", "C", "B"]);
    expect(movedC.version).toBe(2);

    // A to top of "in_review"
    const r = await newTask({ title: "R", status: "in_review" });
    await moveTask(ctx, { id: a.id, status: "in_review", afterId: null, beforeId: r.id });
    const review = (await listTasks(ctx)).filter((t) => t.status === "in_review").map((t) => t.title);
    expect(review).toEqual(["A", "R"]);
  });

  it("keeps order stable after many insertions into the same gap (renormalization)", async () => {
    const a = await newTask({ title: "A" });
    const b = await newTask({ title: "B" });
    let before = b.id;
    for (let i = 0; i < 60; i++) {
      const t = await newTask({ title: `X${i}` });
      await moveTask(ctx, { id: t.id, status: "open", afterId: a.id, beforeId: before });
      before = t.id;
    }
    const order = (await listTasks(ctx)).filter((t) => t.status === "open").map((t) => t.title);
    expect(order[0]).toBe("A");
    expect(order.at(-1)).toBe("B");
    expect(order[1]).toBe("X59");
    expect(new Set((await listTasks(ctx)).map((t) => t.position)).size).toBe(62);
  });

  it("status quick action moves the task to the end of the target column", async () => {
    const d1 = await newTask({ title: "D1", status: "done" });
    const t = await newTask({ title: "T" });
    const moved = await setTaskStatus(ctx, { id: t.id, status: "done" });
    expect(moved.status).toBe("done");
    expect(moved.position).toBeGreaterThan(d1.position);
  });
});

describe("assignees", () => {
  it("only active members can be assigned", async () => {
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    const t = await newTask();
    await expect(setTaskAssignee(ctx, { id: t.id, assigneeId: removed.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const ok = await setTaskAssignee(ctx, { id: t.id, assigneeId: ctx.userId });
    expect(ok.assigneeId).toBe(ctx.userId);
  });

  it("database trigger rejects inactive assignees even when bypassing the service", async () => {
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    const t = await newTask();
    await expect(getDb().update(tasks).set({ assigneeId: removed.id }).where(eqId(t.id))).rejects.toThrow();
  });
});

describe("several assignees", () => {
  it("keeps order, drops duplicates and mirrors the first person in assigneeId", async () => {
    const { user: b } = await makeMemberCtx(wsId);
    const { user: c } = await makeMemberCtx(wsId);
    const t = await newTask({ assigneeIds: [b.id, ctx.userId, b.id] });
    expect(t.assigneeIds).toEqual([b.id, ctx.userId]);
    expect(t.assigneeId).toBe(b.id);
    const next = await setTaskAssignees(ctx, { id: t.id, assigneeIds: [c.id, b.id] });
    expect(next.assigneeIds).toEqual([c.id, b.id]);
    expect(next.assigneeId).toBe(c.id);
    const none = await setTaskAssignees(ctx, { id: t.id, assigneeIds: [] });
    expect(none.assigneeIds).toEqual([]);
    expect(none.assigneeId).toBeNull();
  });

  it("an unchanged list is a no-op (no new version)", async () => {
    const t = await newTask({ assigneeIds: [ctx.userId] });
    const same = await setTaskAssignees(ctx, { id: t.id, assigneeIds: [ctx.userId] });
    expect(same.version).toBe(t.version);
  });

  it("assigneeIds wins over the legacy assigneeId in creates and edits", async () => {
    const { user: b } = await makeMemberCtx(wsId);
    const t = await newTask({ assigneeId: ctx.userId, assigneeIds: [b.id] });
    expect(t.assigneeIds).toEqual([b.id]);
    const u = await updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { assigneeId: ctx.userId, assigneeIds: [ctx.userId, b.id] } });
    expect(u.assigneeIds).toEqual([ctx.userId, b.id]);
  });

  it("older clients: the single assignee replaces the whole list; edits without it keep the list", async () => {
    const { user: b } = await makeMemberCtx(wsId);
    const t = await newTask({ assigneeIds: [ctx.userId, b.id] });
    const titled = await updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { title: "Neu" } });
    expect(titled.assigneeIds).toEqual([ctx.userId, b.id]);
    const legacy = await setTaskAssignee(ctx, { id: t.id, assigneeId: b.id });
    expect(legacy.assigneeIds).toEqual([b.id]);
    const cleared = await updateTask(ctx, { id: t.id, expectedVersion: legacy.version, patch: { assigneeId: null } });
    expect(cleared.assigneeIds).toEqual([]);
  });

  it("every assignee must be an active member", async () => {
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    const t = await newTask();
    await expect(setTaskAssignees(ctx, { id: t.id, assigneeIds: [ctx.userId, removed.id] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(newTask({ assigneeIds: [removed.id] })).rejects.toMatchObject({ code: "VALIDATION" });
    // Bypassing the service: the trigger checks the whole list.
    await expect(
      getDb().update(tasks).set({ assigneeIds: [ctx.userId, removed.id] }).where(eqId(t.id)),
    ).rejects.toThrow();
  });

  it("legacy SQL writes of assignee_id keep the list in sync (trigger)", async () => {
    const { user: b } = await makeMemberCtx(wsId);
    const t = await newTask({ assigneeIds: [ctx.userId, b.id] });
    await getDb().update(tasks).set({ assigneeId: b.id }).where(eqId(t.id));
    const [row] = await getDb().select().from(tasks).where(eqId(t.id));
    expect(row.assigneeIds).toEqual([b.id]);
  });

  it("removing a member takes them off every list, other assignees stay", async () => {
    const admin = (await makeMemberCtx(wsId, "admin")).ctx;
    const { user: b } = await makeMemberCtx(wsId);
    const t = await newTask({ assigneeIds: [b.id, ctx.userId] });
    const res = await removeMember(admin, b.id);
    expect(res.unassignedTasks).toBe(1);
    const [row] = await getDb().select().from(tasks).where(eqId(t.id));
    expect(row.assigneeIds).toEqual([ctx.userId]);
    expect(row.assigneeId).toBe(ctx.userId);
  });
});

describe("backlog", () => {
  it("is a regular column left of open: create, move and quick status work", async () => {
    const t = await newTask({ status: "backlog" });
    expect(t.status).toBe("backlog");
    const open = await setTaskStatus(ctx, { id: t.id, status: "open" });
    expect(open.status).toBe("open");
    const back = await moveTask(ctx, { id: t.id, status: "backlog", afterId: null, beforeId: null });
    expect(back.status).toBe("backlog");
    expect((await listTasks(ctx)).find((x) => x.id === t.id)?.status).toBe("backlog");
  });
});

describe("markdown checklist", () => {
  const md = "## Aufgaben\n\n- [x] Datenbank\n- [ ] API\n  - [ ] Endpunkte\n\n```\n- [ ] Code\n```\n";

  it("ticks one item, changes nothing else and leaves the status alone", async () => {
    const t = await newTask({ description: md });
    const next = await setTaskChecklistItem(ctx, { id: t.id, index: 2, checked: true, text: "Endpunkte" });
    expect(next.description).toBe(md.replace("  - [ ] Endpunkte", "  - [x] Endpunkte"));
    expect(next.version).toBe(t.version + 1);
    expect(next.status).toBe("open");
    const back = await setTaskChecklistItem(ctx, { id: t.id, index: 0, checked: false, text: "Datenbank" });
    expect(back.description.startsWith("## Aufgaben\n\n- [ ] Datenbank")).toBe(true);
    expect((await listTasks(ctx)).find((x) => x.id === t.id)?.description).toBe(back.description);
  });

  it("does not overwrite concurrent edits", async () => {
    const t = await newTask({ description: md });
    // Someone else edits the title and inserts a line above while the view is open.
    const other = await updateTask(ctx, {
      id: t.id,
      expectedVersion: t.version,
      patch: { title: "Neu", description: md.replace("- [x] Datenbank", "- [ ] Neu\n- [x] Datenbank") },
    });
    // Stale index 1 ("API" in the old text) is resolved by text.
    const next = await setTaskChecklistItem(ctx, { id: t.id, index: 1, checked: true, text: "API" });
    expect(next.title).toBe("Neu");
    expect(next.description).toBe(other.description.replace("- [ ] API", "- [x] API"));
  });

  it("parallel toggles of different items both survive", async () => {
    const t = await newTask({ description: md });
    await Promise.all([
      setTaskChecklistItem(ctx, { id: t.id, index: 1, checked: true, text: "API" }),
      setTaskChecklistItem(ctx, { id: t.id, index: 2, checked: true, text: "Endpunkte" }),
    ]);
    const [row] = await getDb().select().from(tasks).where(eqId(t.id));
    expect(row.description).toContain("- [x] API\n  - [x] Endpunkte");
    expect(row.version).toBe(t.version + 2);
  });

  it("reports a conflict when the item is gone, and is a no-op when unchanged", async () => {
    const t = await newTask({ description: md });
    await expect(
      setTaskChecklistItem(ctx, { id: t.id, index: 1, checked: true, text: "Gelöscht" }),
    ).rejects.toMatchObject({ code: "CONFLICT", extra: { current: { id: t.id } } });
    const same = await setTaskChecklistItem(ctx, { id: t.id, index: 0, checked: true, text: "Datenbank" });
    expect(same.version).toBe(t.version);
  });

  it("is blocked in archived projects", async () => {
    const t = await newTask({ description: md });
    await setProjectArchived(ctx, { id: projectId, archived: true });
    await expect(
      setTaskChecklistItem(ctx, { id: t.id, index: 1, checked: true, text: "API" }),
    ).rejects.toMatchObject({ code: "ARCHIVED" });
  });
});

describe("archived projects are read-only", () => {
  it("blocks task writes but still lists the project's tasks on demand", async () => {
    const t = await newTask();
    await setProjectArchived(ctx, { id: projectId, archived: true });
    await expect(newTask()).rejects.toMatchObject({ code: "ARCHIVED" });
    await expect(updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { title: "x" } })).rejects.toMatchObject({
      code: "ARCHIVED",
    });
    await expect(deleteTask(ctx, t.id)).rejects.toMatchObject({ code: "ARCHIVED" });
    expect((await listTasks(ctx)).map((x) => x.id)).not.toContain(t.id);
    expect((await listTasks(ctx, { projectId })).map((x) => x.id)).toContain(t.id);

    await setProjectArchived(ctx, { id: projectId, archived: false });
    expect((await listTasks(ctx)).map((x) => x.id)).toContain(t.id);
  });
});

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(tasks.id, id);
}
