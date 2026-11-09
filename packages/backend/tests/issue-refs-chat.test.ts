import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRefToken as ref, MISSING_ISSUE_LABEL } from "@vistoo/domain/issue-refs";
import { mentionToken } from "@vistoo/domain/mentions";
import type { AuthContext } from "../src/auth";
import { createChannel, editMessage, getMessage, listMessages, openDm, sendMessage } from "../src/services/chat";
import { listNotifications } from "../src/services/inbox";
import { messagePush } from "../src/services/notifications";
import { createTask, deleteTask, updateTask } from "../src/services/tasks";
import { makeMemberCtx, makeProject, makeWorkspace } from "./support/fixtures";

let wsId: string;
let anna: AuthContext;
let ben: AuthContext;
let outsider: AuthContext;
let projectId: string;

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId, "admin")).ctx;
  ben = (await makeMemberCtx(wsId)).ctx;
  const otherWs = (await makeWorkspace("Andere")).id;
  outsider = (await makeMemberCtx(otherWs)).ctx;
  projectId = (await makeProject(wsId)).id;
});

const task = (ctx: AuthContext, title: string, project = projectId) =>
  createTask(ctx, {
    projectId: project,
    title,
    description: "",
    status: "open",
    milestoneId: null,
    assigneeId: null,
    startDate: null,
    endDate: null,
  });

const send = (ctx: AuthContext, conversationId: string, body: string, id = randomUUID()) =>
  sendMessage(ctx, { id, conversationId, body, attachmentIds: [] });

const channel = () =>
  createChannel(anna, { name: `team-${randomUUID().slice(0, 6)}`, description: "", visibility: "open", memberIds: [] });

describe("issue references in chat messages", () => {
  it("stores ids, resolves numbers and titles, and survives reload and renames", async () => {
    const a = await task(anna, "Implement AR navigation");
    const b = await task(anna, "Fix dashboard layout");
    const ch = await channel();
    const markup = `${mentionToken(ben.userId)} kannst du dir bitte ${ref(a.id)} und ${ref(b.id)} anschauen?`;
    const sent = await send(anna, ch.id, markup);
    expect(sent.markup).toBe(markup);
    expect(sent.body).toMatch(/kannst du dir bitte #1 und #2 anschauen\?$/);
    expect(sent.mentionIds).toEqual([ben.userId]);
    expect(sent.issueRefs.map((r) => [r.number, r.title, r.status])).toEqual([
      [1, "Implement AR navigation", "open"],
      [2, "Fix dashboard layout", "open"],
    ]);

    await updateTask(anna, { id: a.id, expectedVersion: a.version, patch: { title: "AR-Navigation", status: "done" } });
    const page = await listMessages(ben, { conversationId: ch.id, beforeSeq: null, afterSeq: null });
    const reloaded = page.messages.find((m) => m.id === sent.id)!;
    expect(reloaded.issueRefs[0]).toMatchObject({ id: a.id, number: 1, title: "AR-Navigation", status: "done" });
    expect((await getMessage(ben, sent.id)).message.issueRefs).toHaveLength(2);
  });

  it("refuses references to tasks of another workspace or unknown ids", async () => {
    const foreign = await task(outsider, "Geheim", (await makeProject(outsider.workspaceId)).id);
    const ch = await channel();
    await expect(send(anna, ch.id, `Siehe ${ref(foreign.id)}`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(send(anna, ch.id, `Siehe ${ref(randomUUID())}`)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deleted tasks render as missing; editing keeps them but cannot add new invalid ones", async () => {
    const a = await task(anna, "Wird gelöscht");
    const b = await task(anna, "Bleibt");
    const ch = await channel();
    const sent = await send(anna, ch.id, `Erst ${ref(a.id)}`);
    await deleteTask(anna, a.id);

    const after = (await getMessage(anna, sent.id)).message;
    expect(after.issueRefs).toEqual([]);
    expect(after.body).toBe(`Erst ${MISSING_ISSUE_LABEL}`);
    expect(after.markup).toBe(`Erst ${ref(a.id)}`);

    const edited = await editMessage(anna, { id: sent.id, body: `Erst ${ref(a.id)}, dann ${ref(b.id)}` });
    expect(edited.issueRefs.map((r) => r.number)).toEqual([b.number]);
    const c = await task(anna, "Kurz da");
    await deleteTask(anna, c.id);
    await expect(editMessage(anna, { id: sent.id, body: `Neu ${ref(c.id)}` })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("plain #numbers stay plain text", async () => {
    await task(anna, "Eins");
    const ch = await channel();
    const sent = await send(anna, ch.id, "Platz #1 im Ranking");
    expect(sent.issueRefs).toEqual([]);
    expect(sent.body).toBe("Platz #1 im Ranking");
  });

  it("push and inbox previews show #numbers, never raw tokens", async () => {
    const a = await task(anna, "Push-Test");
    const dm = await openDm(anna, ben.userId);
    const sent = await send(anna, dm.id, `${mentionToken(ben.userId)} bitte ${ref(a.id)}`);
    const push = await messagePush(sent.id);
    expect(push?.message.body).toContain(`bitte #${a.number}`);
    expect(push?.message.body).not.toContain("<#");
    const inbox = await listNotifications(ben);
    expect(inbox.notifications[0].preview).toContain(`#${a.number}`);
  });
});
