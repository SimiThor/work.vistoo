import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveMembership } from "../src/auth";
import { AppError } from "../src/errors";
import { createTask, getTask, listTasks, updateTask } from "../src/services/tasks";
import { getProject, listProjects } from "../src/services/projects";
import { addMember, ctxFor, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { testDatabaseUrl } from "./support/db-url";

describe("membership resolution", () => {
  it("returns no context for an authenticated user without membership", async () => {
    await makeWorkspace();
    const stranger = await makeUser();
    expect(await resolveMembership(stranger)).toBeNull();
  });

  it("returns no context for a removed member", async () => {
    const ws = await makeWorkspace();
    const user = await makeUser();
    await addMember(ws.id, user, "admin", "removed");
    expect(await resolveMembership(user)).toBeNull();
  });

  it("returns the workspace and role for an active member", async () => {
    const ws = await makeWorkspace();
    const user = await makeUser();
    await addMember(ws.id, user, "admin");
    const ctx = await ctxFor(user);
    expect(ctx.workspaceId).toBe(ws.id);
    expect(ctx.role).toBe("admin");
  });
});

describe("workspace isolation (foreign IDs)", () => {
  it("cannot read, update or attach to objects of another workspace", async () => {
    const wsA = await makeWorkspace("A");
    const wsB = await makeWorkspace("B");
    const { ctx: a } = await makeMemberCtx(wsA.id);
    const { ctx: b, user: userB } = await makeMemberCtx(wsB.id);

    const projectB = await makeProject(wsB.id, "Geheim");
    const taskB = await createTask(b, {
      projectId: projectB.id,
      title: "Interne Aufgabe",
      description: "",
      status: "open",
      milestoneId: null,
      assigneeId: null,
      startDate: null,
      endDate: null,
    });

    await expect(getTask(a, taskB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProject(a, projectB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateTask(a, { id: taskB.id, expectedVersion: 1, patch: { title: "gehackt" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listTasks(a)).map((t) => t.id)).not.toContain(taskB.id);
    expect((await listProjects(a)).map((p) => p.id)).not.toContain(projectB.id);

    // Creating a task in a foreign project or with a foreign assignee fails.
    const projectA = await makeProject(wsA.id);
    const base = {
      title: "x",
      description: "",
      status: "open" as const,
      milestoneId: null,
      assigneeId: null,
      startDate: null,
      endDate: null,
    };
    await expect(createTask(a, { ...base, projectId: projectB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createTask(a, { ...base, projectId: projectA.id, assigneeId: userB.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("row level security for the Supabase Data API / Realtime", () => {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  let wsId: string;
  let memberId: string;
  let removedId: string;
  let strangerId: string;

  beforeAll(async () => {
    const ws = await makeWorkspace("RLS");
    wsId = ws.id;
    const { ctx, user } = await makeMemberCtx(ws.id);
    memberId = user.id;
    const removed = await makeUser();
    await addMember(ws.id, removed, "member", "removed");
    removedId = removed.id;
    strangerId = (await makeUser()).id;
    const project = await makeProject(ws.id, "RLS-Projekt");
    await createTask(ctx, {
      projectId: project.id,
      title: "Sichtbar nur für Mitglieder",
      description: "",
      status: "open",
      milestoneId: null,
      assigneeId: null,
      startDate: null,
      endDate: null,
    });
  });

  afterAll(() => sql.end());

  async function asUser<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let out: T;
    await sql
      .begin(async (tx) => {
        if (userId) {
          await tx.unsafe(`SET LOCAL ROLE authenticated`);
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        } else {
          await tx.unsafe(`SET LOCAL ROLE anon`);
        }
        out = await fn(tx);
        throw new Error("rollback");
      })
      .catch((e) => {
        if ((e as Error).message !== "rollback") throw e;
      });
    return out!;
  }

  it("active members can read tasks of their workspace", async () => {
    const rows = await asUser(memberId, (tx) => tx`select id from tasks where workspace_id = ${wsId}`);
    expect(rows.length).toBe(1);
  });

  it("removed members and strangers see nothing", async () => {
    for (const id of [removedId, strangerId]) {
      const rows = await asUser(id, (tx) => tx`select id from tasks where workspace_id = ${wsId}`);
      expect(rows.length).toBe(0);
      const projects = await asUser(id, (tx) => tx`select id from projects where workspace_id = ${wsId}`);
      expect(projects.length).toBe(0);
    }
  });

  it("anon has no access at all", async () => {
    await expect(asUser(null, (tx) => tx`select id from tasks`)).rejects.toThrow(/permission denied/);
  });

  it("authenticated users cannot write through the Data API", async () => {
    await expect(
      asUser(memberId, (tx) => tx`update tasks set title = 'x' where workspace_id = ${wsId}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(memberId, (tx) => tx`select * from workspace_invitations`),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(memberId, (tx) => tx`select * from profiles`)).rejects.toThrow(/permission denied/);
  });
});

describe("AppError", () => {
  it("is used for typed failures", () => {
    expect(new AppError("FORBIDDEN", "x").code).toBe("FORBIDDEN");
  });
});
