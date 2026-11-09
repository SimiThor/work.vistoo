import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pushDevices } from "@vistoo/database/schema";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { setPushTransportForTests, type PushMessage } from "../src/push/apns";
import { setBackgroundRunner } from "../src/push/background";
import { createChannel, openDm, sendMessage } from "../src/services/chat";
import { registerDevice, updateNotificationSettings, getNotificationSettings } from "../src/services/notifications";
import { createTask, setTaskAssignee, updateTask } from "../src/services/tasks";
import { removeMember } from "../src/services/team";
import { makeMemberCtx, makeProject, makeWorkspace } from "./support/fixtures";

/** Pushes "delivered" in this test: token → messages. */
const delivered: { token: string; message: PushMessage }[] = [];
let pending: Promise<void>[] = [];
const flush = async () => {
  await Promise.all(pending);
  pending = [];
};

beforeAll(() => {
  setBackgroundRunner((task) => pending.push(task()));
  setPushTransportForTests(async (token, _env, message) => {
    if (token.startsWith("dead")) return "unregistered";
    delivered.push({ token, message });
    return "sent";
  });
});
afterAll(() => {
  setBackgroundRunner(null);
  setPushTransportForTests(null);
});

let wsId: string;
let anna: AuthContext; // admin
let ben: AuthContext;
let carla: AuthContext;
const tokenOf = (ctx: AuthContext) => `ab${ctx.userId.replace(/-/g, "")}`;
const receivedBy = (ctx: AuthContext) => delivered.filter((d) => d.token === tokenOf(ctx)).map((d) => d.message);

beforeEach(async () => {
  delivered.length = 0;
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId, "admin")).ctx;
  ben = (await makeMemberCtx(wsId)).ctx;
  carla = (await makeMemberCtx(wsId)).ctx;
  for (const ctx of [anna, ben, carla]) await registerDevice(ctx, { token: tokenOf(ctx), environment: "sandbox" });
});

const send = (ctx: AuthContext, conversationId: string, body: string, id = randomUUID()) =>
  sendMessage(ctx, { id, conversationId, body, attachmentIds: [] });

describe("message pushes", () => {
  it("DM: only the partner, never the author; retries do not notify twice", async () => {
    const dm = await openDm(anna, ben.userId);
    const id = randomUUID();
    await send(anna, dm.id, "Hallo Ben", id);
    await send(anna, dm.id, "Hallo Ben", id); // idempotent retry
    await flush();
    expect(receivedBy(ben)).toHaveLength(1);
    expect(receivedBy(ben)[0]).toMatchObject({ body: "Hallo Ben", link: { conversationId: dm.id } });
    expect(receivedBy(anna)).toHaveLength(0);
    expect(receivedBy(carla)).toHaveLength(0);
  });

  it("private channel: participants only (admin without membership gets nothing)", async () => {
    const ch = await createChannel(ben, { name: `Intern ${randomUUID().slice(0, 4)}`, description: "", visibility: "private", memberIds: [carla.userId] });
    await send(ben, ch.id, "Geheim");
    await flush();
    expect(receivedBy(carla)).toHaveLength(1);
    expect(receivedBy(carla)[0].title).toMatch(/^#Intern/);
    expect(receivedBy(anna)).toHaveLength(0);
  });

  it("open channel: everyone active, respecting the channel preference", async () => {
    await updateNotificationSettings(carla, { channelMessages: false });
    const ch = await createChannel(anna, { name: `Offen ${randomUUID().slice(0, 4)}`, description: "", visibility: "open", memberIds: [] });
    await send(anna, ch.id, "An alle");
    await flush();
    expect(receivedBy(ben)).toHaveLength(1);
    expect(receivedBy(carla)).toHaveLength(0);
    expect(await getNotificationSettings(carla)).toEqual({ directMessages: true, channelMessages: false, taskAssignments: true });
  });

  it("removed members get nothing", async () => {
    const ch = await createChannel(anna, { name: `Alle ${randomUUID().slice(0, 4)}`, description: "", visibility: "open", memberIds: [] });
    await removeMember(anna, carla.userId);
    await send(anna, ch.id, "Nach dem Entfernen");
    await flush();
    expect(receivedBy(carla)).toHaveLength(0);
    expect(receivedBy(ben)).toHaveLength(1);
  });

  it("tokens rejected by APNs are forgotten", async () => {
    await registerDevice(ben, { token: "deadbeefdeadbeef", environment: "production" });
    const dm = await openDm(anna, ben.userId);
    await send(anna, dm.id, "Hallo");
    await flush();
    expect(await getDb().select().from(pushDevices).where(eq(pushDevices.token, "deadbeefdeadbeef"))).toHaveLength(0);
  });
});

describe("assignment pushes", () => {
  const base = (projectId: string) => ({
    projectId, description: "", status: "open" as const, milestoneId: null, startDate: null, endDate: null,
  });

  it("assigning someone else notifies them; self-assignment does not", async () => {
    const projectId = (await makeProject(wsId)).id;
    await createTask(anna, { ...base(projectId), title: "Für Ben", assigneeId: ben.userId });
    await createTask(anna, { ...base(projectId), title: "Für mich", assigneeId: anna.userId });
    await flush();
    expect(receivedBy(ben)).toHaveLength(1);
    expect(receivedBy(ben)[0].body).toContain("„Für Ben“");
    expect(receivedBy(anna)).toHaveLength(0);
  });

  it("reassignment via quick action and edit form; unchanged assignee does not notify again", async () => {
    const projectId = (await makeProject(wsId)).id;
    const task = await createTask(anna, { ...base(projectId), title: "Wandert", assigneeId: null });
    const t1 = await setTaskAssignee(anna, { id: task.id, assigneeId: carla.userId });
    await updateTask(anna, { id: task.id, expectedVersion: t1.version, patch: { title: "Wandert weiter" } });
    await updateTask(anna, { id: task.id, expectedVersion: t1.version + 1, patch: { assigneeId: ben.userId } });
    await flush();
    expect(receivedBy(carla)).toHaveLength(1);
    expect(receivedBy(ben)).toHaveLength(1);
  });

  it("respects the assignment preference", async () => {
    await updateNotificationSettings(ben, { taskAssignments: false });
    const projectId = (await makeProject(wsId)).id;
    await createTask(anna, { ...base(projectId), title: "Still", assigneeId: ben.userId });
    await flush();
    expect(receivedBy(ben)).toHaveLength(0);
  });
});
