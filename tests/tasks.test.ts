import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { tasks } from "@/server/db/schema";
import { createGroup, deleteGroup, setProjectArchived } from "@/server/services/projects";
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  setTaskAssignee,
  setTaskStatus,
  updateTask,
} from "@/server/services/tasks";
import { createTaskSchema, updateTaskSchema } from "@/lib/validation";
import { makeGroup, makeMemberCtx, makeProject, makeUser, makeWorkspace, addMember } from "./support/fixtures";

let ctx: AuthContext;
let wsId: string;
let projectId: string;

const newTask = (over: Partial<Parameters<typeof createTask>[1]> = {}) =>
  createTask(ctx, {
    projectId,
    title: "Aufgabe",
    description: "",
    status: "open",
    groupId: null,
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

describe("groups", () => {
  it("rejects a group of another project", async () => {
    const other = await makeProject(wsId, "Anderes Projekt");
    const foreignGroup = await makeGroup(wsId, other.id, "Launch");
    await expect(newTask({ groupId: foreignGroup.id })).rejects.toMatchObject({ code: "VALIDATION" });

    const t = await newTask();
    await expect(
      updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { groupId: foreignGroup.id } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("database rejects a mismatched group even when bypassing the service", async () => {
    const other = await makeProject(wsId, "Anderes Projekt");
    const foreignGroup = await makeGroup(wsId, other.id, "Launch");
    const t = await newTask();
    await expect(
      getDb().update(tasks).set({ groupId: foreignGroup.id }).where(eqId(t.id)),
    ).rejects.toThrow();
  });

  it("resets the group when the project changes", async () => {
    const group = await makeGroup(wsId, projectId, "Design");
    const t = await newTask({ groupId: group.id });
    const other = await makeProject(wsId, "Zielprojekt");
    const moved = await updateTask(ctx, { id: t.id, expectedVersion: t.version, patch: { projectId: other.id } });
    expect(moved.projectId).toBe(other.id);
    expect(moved.groupId).toBeNull();
  });

  it("deleting a group keeps its tasks and detaches them", async () => {
    const group = await createGroup(ctx, { projectId, name: "Engineering" });
    const t = await newTask({ groupId: group.id });
    const result = await deleteGroup(ctx, group.id);
    expect(result.detachedTasks).toBe(1);
    const after = (await listTasks(ctx)).find((x) => x.id === t.id);
    expect(after?.groupId).toBeNull();
  });

  it("group names are unique per project (case-insensitive)", async () => {
    await createGroup(ctx, { projectId, name: "Produkt" });
    await expect(createGroup(ctx, { projectId, name: "produkt" })).rejects.toThrow();
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
