import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { taskLinks } from "@vistoo/database/schema";
import { LINK_LIMITS } from "@vistoo/domain/links";
import { createTaskLinkSchema, meetingUrlSchema, updateTaskLinkSchema } from "@vistoo/domain/validation";
import { setProjectArchived } from "../src/services/projects";
import { getViewerProfile } from "../src/services/session";
import { createTaskLink, deleteTaskLink, listTaskLinks, updateTaskLink } from "../src/services/task-links";
import { createTask, deleteTask } from "../src/services/tasks";
import { updateMeetingUrl } from "../src/services/workspace";
import { addMember, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { testDatabaseUrl } from "./support/db-url";

let ctx: AuthContext;
let wsId: string;
let projectId: string;
let taskId: string;

async function newTask(c: AuthContext, project: string) {
  return createTask(c, {
    projectId: project,
    title: "Pitch Deck",
    description: "",
    status: "open",
    groupId: null,
    assigneeId: null,
    startDate: null,
    endDate: null,
  });
}

/** Same path as the adapters: raw input → shared schema → service. */
const add = (c: AuthContext, input: Record<string, unknown>) =>
  createTaskLink(c, createTaskLinkSchema.parse({ taskId, ...input }));

beforeEach(async () => {
  const ws = await makeWorkspace();
  wsId = ws.id;
  ctx = (await makeMemberCtx(ws.id)).ctx;
  projectId = (await makeProject(ws.id)).id;
  taskId = (await newTask(ctx, projectId)).id;
});

describe("task links", () => {
  it("adds, lists, edits and removes links; any member may manage them", async () => {
    const a = await add(ctx, { url: "docs.google.com/document/d/abc", title: "  Briefing  " });
    expect(a).toMatchObject({ taskId, url: "https://docs.google.com/document/d/abc", title: "Briefing", createdBy: ctx.userId });
    const b = await add(ctx, { url: "https://github.com/vistoo/app/pull/7", title: "" });
    expect(b.title).toBeNull();

    expect((await listTaskLinks(ctx, taskId)).map((l) => l.id)).toEqual([a.id, b.id]);

    const colleague = (await makeMemberCtx(wsId)).ctx;
    const edited = await updateTaskLink(
      colleague,
      updateTaskLinkSchema.parse({ id: a.id, url: "https://figma.com/design/x", title: "Entwurf" }),
    );
    expect(edited).toMatchObject({ url: "https://figma.com/design/x", title: "Entwurf" });

    await deleteTaskLink(colleague, b.id);
    expect((await listTaskLinks(ctx, taskId)).map((l) => l.id)).toEqual([a.id]);
    await expect(deleteTaskLink(ctx, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unsafe URLs before and inside the database", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com/x", "https://a:b@example.com"]) {
      expect(createTaskLinkSchema.safeParse({ taskId, url }).success, url).toBe(false);
    }
    // Bypassing the service: the CHECK constraint still only accepts http(s).
    await expect(
      getDb().insert(taskLinks).values({ workspaceId: wsId, taskId, url: "javascript:alert(1)", createdBy: ctx.userId }),
    ).rejects.toThrow();
  });

  it("create is idempotent with a client id", async () => {
    const id = randomUUID();
    const first = await add(ctx, { id, url: "https://vistoo.de" });
    const retry = await add(ctx, { id, url: "https://vistoo.de" });
    expect(retry.id).toBe(first.id);
    expect(await listTaskLinks(ctx, taskId)).toHaveLength(1);

    const other = (await makeMemberCtx(wsId)).ctx;
    await expect(add(other, { id, url: "https://vistoo.de" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("limits the number of links per task", async () => {
    await getDb()
      .insert(taskLinks)
      .values(
        Array.from({ length: LINK_LIMITS.perTask }, (_, i) => ({
          workspaceId: wsId,
          taskId,
          url: `https://example.com/${i}`,
          createdBy: ctx.userId,
        })),
      );
    await expect(add(ctx, { url: "https://example.com/zu-viel" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("links of archived projects are read-only but still listed", async () => {
    const link = await add(ctx, { url: "https://vistoo.de" });
    await setProjectArchived(ctx, { id: projectId, archived: true });
    expect(await listTaskLinks(ctx, taskId)).toHaveLength(1);
    await expect(add(ctx, { url: "https://example.com" })).rejects.toMatchObject({ code: "ARCHIVED" });
    await expect(
      updateTaskLink(ctx, updateTaskLinkSchema.parse({ id: link.id, url: "https://example.com", title: null })),
    ).rejects.toMatchObject({ code: "ARCHIVED" });
    await expect(deleteTaskLink(ctx, link.id)).rejects.toMatchObject({ code: "ARCHIVED" });
  });

  it("ids from another workspace behave like missing ones", async () => {
    const link = await add(ctx, { url: "https://vistoo.de" });
    const otherWs = await makeWorkspace("Andere");
    const outsider = (await makeMemberCtx(otherWs.id)).ctx;
    await expect(listTaskLinks(outsider, taskId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(add(outsider, { url: "https://vistoo.de" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateTaskLink(outsider, updateTaskLinkSchema.parse({ id: link.id, url: "https://evil.example", title: null })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteTaskLink(outsider, link.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("are deleted together with their task", async () => {
    const link = await add(ctx, { url: "https://vistoo.de" });
    await deleteTask(ctx, taskId);
    expect(await getDb().select().from(taskLinks).where(eq(taskLinks.id, link.id))).toHaveLength(0);
  });
});

describe("meeting link", () => {
  it("is null until an admin sets it; members cannot change it", async () => {
    expect((await getViewerProfile(ctx)).meetingUrl).toBeNull();
    await expect(
      updateMeetingUrl(ctx, meetingUrlSchema.parse({ meetingUrl: "https://discord.com/channels/1/2" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const admin = (await makeMemberCtx(wsId, "admin")).ctx;
    await updateMeetingUrl(admin, meetingUrlSchema.parse({ meetingUrl: "discord.com/channels/1/2" }));
    expect((await getViewerProfile(ctx)).meetingUrl).toBe("https://discord.com/channels/1/2");

    await updateMeetingUrl(admin, meetingUrlSchema.parse({ meetingUrl: null }));
    expect((await getViewerProfile(ctx)).meetingUrl).toBeNull();
    expect(meetingUrlSchema.safeParse({ meetingUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("row level security", () => {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
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

  it("only active members can read links; nobody can write through the Data API", async () => {
    await add(ctx, { url: "https://vistoo.de" });
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    const stranger = await makeUser();

    expect(await asUser(ctx.userId, (tx) => tx`select id from task_links where task_id = ${taskId}`)).toHaveLength(1);
    for (const id of [removed.id, stranger.id]) {
      expect(await asUser(id, (tx) => tx`select id from task_links where task_id = ${taskId}`)).toHaveLength(0);
    }
    await expect(asUser(null, (tx) => tx`select id from task_links`)).rejects.toThrow(/permission denied/);
    await expect(
      asUser(ctx.userId, (tx) => tx`update task_links set url = 'https://evil.example' where task_id = ${taskId}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        ctx.userId,
        (tx) =>
          tx`insert into task_links (workspace_id, task_id, url, created_by) values (${wsId}, ${taskId}, 'https://x.de', ${ctx.userId})`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
