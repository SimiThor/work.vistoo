import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { tasks } from "@vistoo/database/schema";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "../src/services/tasks";
import { assertReferenceable, resolveIssueRefs, searchIssues } from "../src/services/issue-refs";
import { setProjectArchived } from "../src/services/projects";
import { makeMemberCtx, makeProject, makeWorkspace } from "./support/fixtures";

let ctx: AuthContext;
let wsId: string;
let projectId: string;

const newTask = (title = "Aufgabe", project = projectId, c = ctx) =>
  createTask(c, {
    projectId: project,
    title,
    description: "",
    status: "open",
    milestoneId: null,
    assigneeId: null,
    startDate: null,
    endDate: null,
  });

beforeEach(async () => {
  const ws = await makeWorkspace();
  wsId = ws.id;
  ctx = (await makeMemberCtx(ws.id)).ctx;
  projectId = (await makeProject(ws.id)).id;
});

describe("issue numbers", () => {
  it("start at 1 and count up across all projects of a workspace", async () => {
    const other = await makeProject(wsId, "Zweites Projekt");
    const a = await newTask("A");
    const b = await newTask("B", other.id);
    const c = await newTask("C");
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
    expect((await getTask(ctx, b.id)).number).toBe(2);
    expect((await listTasks(ctx)).map((t) => t.number).sort()).toEqual([1, 2, 3]);
  });

  it("are counted per workspace", async () => {
    await newTask();
    await newTask();
    const ws2 = await makeWorkspace();
    const ctx2 = (await makeMemberCtx(ws2.id)).ctx;
    const p2 = await makeProject(ws2.id);
    expect((await newTask("Fremd", p2.id, ctx2)).number).toBe(1);
    expect((await newTask()).number).toBe(3);
  });

  it("are never reused after a delete", async () => {
    await newTask();
    const second = await newTask();
    await deleteTask(ctx, second.id);
    expect((await newTask()).number).toBe(3);
  });

  it("stay unique when many tasks are created at the same time", async () => {
    const created = await Promise.all(Array.from({ length: 25 }, (_, i) => newTask(`Parallel ${i}`)));
    const numbers = created.map((t) => t.number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("do not change on updates, retries or moves to another project", async () => {
    const t = await newTask();
    const other = await makeProject(wsId, "Zweites Projekt");
    const moved = await updateTask(ctx, {
      id: t.id,
      expectedVersion: t.version,
      patch: { title: "Neu", projectId: other.id },
    });
    expect(moved.number).toBe(t.number);
    // Idempotent retry with the same client id returns the stored number.
    const id = crypto.randomUUID();
    const first = await createTask(ctx, { ...baseInput(), id });
    const retry = await createTask(ctx, { ...baseInput(), id });
    expect(retry.number).toBe(first.number);
    expect((await newTask()).number).toBe(first.number + 1);
  });

  it("are assigned by the database, whatever the writer sends", async () => {
    await newTask();
    const [row] = await getDb()
      .insert(tasks)
      .values({ workspaceId: wsId, projectId, title: "Direkt", position: 1, createdBy: ctx.userId, number: 999 })
      .returning();
    expect(row.number).toBe(2);
  });

  it("database refuses to change a number", async () => {
    const t = await newTask();
    await expect(
      getDb().update(tasks).set({ number: 77 }).where(and(eq(tasks.id, t.id), eq(tasks.workspaceId, wsId))),
    ).rejects.toThrow();
    expect((await getTask(ctx, t.id)).number).toBe(t.number);
  });
});

function baseInput() {
  return {
    projectId,
    title: "Mit Client-ID",
    description: "",
    status: "open" as const,
    milestoneId: null,
    assigneeId: null,
    startDate: null,
    endDate: null,
  };
}

describe("backfill of existing tasks (migration 0016)", () => {
  it("numbers by creation time, ties broken by id, per workspace", async () => {
    // Run the migration's UPDATE against a scratch table with the same columns.
    const migration = readFileSync(
      fileURLToPath(new URL("../../database/migrations/0016_task_numbers.sql", import.meta.url)),
      "utf8",
    );
    const update = migration
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.startsWith('UPDATE "tasks"'));
    expect(update).toBeDefined();

    await getDb().transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE backfill_tasks (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, created_at timestamptz NOT NULL, number integer
      ) ON COMMIT DROP`);
      const w1 = "00000000-0000-4000-8000-000000000001";
      const w2 = "00000000-0000-4000-8000-000000000002";
      await tx.execute(sql`INSERT INTO backfill_tasks (id, workspace_id, created_at) VALUES
        ('00000000-0000-4000-8000-0000000000b2', ${w1}, '2026-01-02T00:00:00Z'),
        ('00000000-0000-4000-8000-0000000000b1', ${w1}, '2026-01-02T00:00:00Z'),
        ('00000000-0000-4000-8000-0000000000a9', ${w1}, '2026-01-01T00:00:00Z'),
        ('00000000-0000-4000-8000-0000000000c1', ${w2}, '2026-03-01T00:00:00Z')`);
      await tx.execute(sql.raw(update!.replaceAll('"tasks"', "backfill_tasks")));
      const rows = (await tx.execute(sql`SELECT id, number FROM backfill_tasks ORDER BY workspace_id, number`)) as unknown as {
        id: string;
        number: number;
      }[];
      expect(rows.map((r) => [r.id.slice(-2), r.number])).toEqual([
        ["a9", 1],
        ["b1", 2],
        ["b2", 3],
        ["c1", 1],
      ]);
    });
  });
});

describe("# picker search and reference resolution", () => {
  it("finds by number (exact first, then prefix) and by title words", async () => {
    for (let i = 1; i <= 24; i++) await newTask(i === 2 ? "Implement AR navigation" : i === 24 ? "Fix dashboard layout" : `Aufgabe ${i}`);
    const byNumber = await searchIssues(ctx, { q: "#2" });
    expect(byNumber[0]).toMatchObject({ number: 2, title: "Implement AR navigation" });
    expect(byNumber.map((r) => r.number)).toEqual(expect.arrayContaining([2, 20, 21, 22, 23, 24]));
    expect((await searchIssues(ctx, { q: "24" }))[0].number).toBe(24);
    expect((await searchIssues(ctx, { q: "dash lay" })).map((r) => r.number)).toEqual([24]);
    expect((await searchIssues(ctx, { q: "navigation" })).map((r) => r.number)).toEqual([2]);
    expect(await searchIssues(ctx, { q: "100%_" })).toEqual([]);
    expect((await searchIssues(ctx, { q: "" })).length).toBe(8);
  });

  it("never shows or resolves tasks of another workspace", async () => {
    const mine = await newTask("Gemeinsamer Titel");
    const ws2 = await makeWorkspace();
    const ctx2 = (await makeMemberCtx(ws2.id)).ctx;
    const foreign = await newTask("Gemeinsamer Titel", (await makeProject(ws2.id)).id, ctx2);
    expect(mine.number).toBe(foreign.number); // same number, different workspace
    expect((await searchIssues(ctx, { q: "gemeinsam" })).map((r) => r.id)).toEqual([mine.id]);
    expect((await searchIssues(ctx, { q: `#${foreign.number}` })).map((r) => r.id)).toEqual([mine.id]);
    expect((await resolveIssueRefs(getDb(), ctx, [mine.id, foreign.id])).map((r) => r.id)).toEqual([mine.id]);
    await expect(assertReferenceable(getDb(), ctx, [foreign.id])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertReferenceable(getDb(), ctx, [mine.id])).resolves.toBeUndefined();
  });

  it("omits archived projects in the picker but still resolves their tasks", async () => {
    const t = await newTask("Archivierte Arbeit");
    await setProjectArchived(ctx, { id: projectId, archived: true });
    expect(await searchIssues(ctx, { q: "archiviert" })).toEqual([]);
    expect((await resolveIssueRefs(getDb(), ctx, [t.id]))[0]).toMatchObject({ number: t.number, status: "open" });
  });

  it("deleted tasks no longer resolve; already present references stay allowed on edit", async () => {
    const t = await newTask();
    await deleteTask(ctx, t.id);
    expect(await resolveIssueRefs(getDb(), ctx, [t.id])).toEqual([]);
    await expect(assertReferenceable(getDb(), ctx, [t.id])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertReferenceable(getDb(), ctx, [t.id], [t.id])).resolves.toBeUndefined();
  });
});
