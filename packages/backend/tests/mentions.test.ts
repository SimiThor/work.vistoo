import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, profiles } from "@vistoo/database/schema";
import { MENTION_ALL_TOKEN as ALL, mentionToken as tok } from "@vistoo/domain/mentions";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import {
  createChannel,
  deleteMessage,
  editMessage,
  getMessage,
  listMessages,
  markRead,
  openDm,
  sendMessage,
} from "../src/services/chat";
import { listNotifications, markNotificationsRead } from "../src/services/inbox";
import { messagePush } from "../src/services/notifications";
import { removeMember } from "../src/services/team";
import { makeMemberCtx, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

const rls = rlsClient();
afterAll(() => rls.end());

let wsId: string;
let anna: AuthContext; // admin
let ben: AuthContext;
let carla: AuthContext;
let outsider: AuthContext; // other workspace

async function named(ctx: AuthContext, fullName: string) {
  await getDb().update(profiles).set({ fullName }).where(eq(profiles.id, ctx.userId));
}

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId, "admin")).ctx;
  ben = (await makeMemberCtx(wsId)).ctx;
  carla = (await makeMemberCtx(wsId)).ctx;
  outsider = (await makeMemberCtx((await makeWorkspace("Andere")).id)).ctx;
  await named(anna, "Anna Admin");
  await named(ben, "Ben Becker");
  await named(carla, "Carla Christ");
});

const send = (ctx: AuthContext, conversationId: string, body: string, id = randomUUID()) =>
  sendMessage(ctx, { id, conversationId, body, attachmentIds: [] });

async function openChannel(ctx = anna) {
  return createChannel(ctx, { name: `team-${randomUUID().slice(0, 6)}`, description: "", visibility: "open", memberIds: [] });
}

describe("storing and rendering mentions", () => {
  it("keeps ids, renders current names and survives reload and renames", async () => {
    const ch = await openChannel();
    const markup = `Hey ${tok(ben.userId)} und ${tok(carla.userId)}, schaut mal`;
    const sent = await send(anna, ch.id, markup);
    expect(sent.markup).toBe(markup);
    expect(sent.mentionIds).toEqual([ben.userId, carla.userId]);
    expect(sent.body).toBe("Hey @Ben Becker und @Carla Christ, schaut mal");

    await named(ben, "Benjamin Becker");
    const page = await listMessages(carla, { conversationId: ch.id, beforeSeq: null, afterSeq: null });
    const m = page.messages.find((x) => x.id === sent.id)!;
    expect(m.markup).toBe(markup);
    expect(m.body).toBe("Hey @Benjamin Becker und @Carla Christ, schaut mal");
    expect(page.authors.map((a) => a.userId).sort()).toEqual([anna.userId, ben.userId, carla.userId].sort());

    const single = await getMessage(ben, sent.id);
    expect(single.message.body).toContain("@Benjamin Becker");
  });

  it("leaves existing plain messages untouched", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, "Hallo @Ben, ganz normal <b>");
    expect(sent.body).toBe("Hallo @Ben, ganz normal <b>");
    expect(sent.markup).toBe(sent.body);
    expect(sent.mentionIds).toEqual([]);
    expect((await listNotifications(ben)).notifications).toHaveLength(0);
  });

  it("renders mentions readable in push previews", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `${tok(ben.userId)} bitte prüfen`);
    const push = await messagePush(sent.id);
    expect(push?.message.body).toBe("@Ben Becker bitte prüfen");
  });
});

describe("who may be mentioned", () => {
  it("rejects people from another workspace and made-up ids", async () => {
    const ch = await openChannel();
    await expect(send(anna, ch.id, `hi ${tok(outsider.userId)}`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(send(anna, ch.id, `hi ${tok(randomUUID())}`)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("private channels and DMs: only participants", async () => {
    const priv = await createChannel(anna, { name: "geheim", description: "", visibility: "private", memberIds: [ben.userId] });
    await send(anna, priv.id, `ok ${tok(ben.userId)}`);
    await expect(send(anna, priv.id, `psst ${tok(carla.userId)}`)).rejects.toMatchObject({ code: "VALIDATION" });

    const dm = await openDm(anna, ben.userId);
    await expect(send(anna, dm.id, `${tok(carla.userId)}?`)).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listNotifications(carla)).notifications).toHaveLength(0);
  });

  it("rejects removed members", async () => {
    const ch = await openChannel();
    await removeMember(anna, carla.userId);
    await expect(send(anna, ch.id, tok(carla.userId))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("mention notifications", () => {
  it("notifies each mentioned person once, never the author; retries do not duplicate", async () => {
    const ch = await openChannel();
    const id = randomUUID();
    const body = `${tok(ben.userId)} ${tok(ben.userId)} ${tok(anna.userId)} ${tok(carla.userId)}`;
    await send(anna, ch.id, body, id);
    await send(anna, ch.id, body, id); // idempotent retry

    const forBen = await listNotifications(ben);
    expect(forBen.unreadCount).toBe(1);
    expect(forBen.notifications[0]).toMatchObject({
      kind: "mention",
      conversationId: ch.id,
      messageId: id,
      actor: { userId: anna.userId },
      readAt: null,
    });
    expect(forBen.notifications[0].conversationTitle).toMatch(/^team-/);
    expect(forBen.notifications[0].preview).toContain("@Ben Becker");
    expect((await listNotifications(carla)).unreadCount).toBe(1);
    expect((await listNotifications(anna)).notifications).toHaveLength(0);
  });

  it("DM title is the author as seen by the recipient", async () => {
    const dm = await openDm(anna, ben.userId);
    await send(anna, dm.id, `${tok(ben.userId)} kurz Zeit?`);
    const [n] = (await listNotifications(ben)).notifications;
    expect(n.conversationTitle).toBe("Anna Admin");
    expect(n.conversationKind).toBe("dm");
  });

  it("editing adds and removes mentions without duplicates", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `Hallo ${tok(ben.userId)}`);
    expect((await listNotifications(ben)).unreadCount).toBe(1);

    await editMessage(anna, { id: sent.id, body: `Hallo ${tok(ben.userId)} und ${tok(carla.userId)}` });
    expect((await listNotifications(ben)).notifications).toHaveLength(1);
    expect((await listNotifications(carla)).notifications).toHaveLength(1);

    const edited = await editMessage(anna, { id: sent.id, body: `Hallo ${tok(carla.userId)}` });
    expect(edited.mentionIds).toEqual([carla.userId]);
    expect((await listNotifications(ben)).notifications).toHaveLength(0);
    expect((await listNotifications(carla)).notifications).toHaveLength(1);
  });

  it("an edit may keep a mention of someone who left, but not add one", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `Danke ${tok(carla.userId)}`);
    await removeMember(anna, carla.userId);
    await expect(editMessage(anna, { id: sent.id, body: `Danke dir ${tok(carla.userId)}!` })).resolves.toBeTruthy();
    const other = await send(anna, ch.id, "zweite");
    await expect(editMessage(anna, { id: other.id, body: `zweite ${tok(carla.userId)}` })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("deleting the message removes its notifications", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `${tok(ben.userId)} hi`);
    await deleteMessage(anna, sent.id);
    expect((await listNotifications(ben)).notifications).toHaveLength(0);
  });

  it("reading the conversation or marking read clears the badge", async () => {
    const ch = await openChannel();
    const a = await send(anna, ch.id, `${tok(ben.userId)} eins`);
    await send(anna, ch.id, `${tok(ben.userId)} zwei`);
    await markRead(ben, { conversationId: ch.id, seq: a.seq });
    expect((await listNotifications(ben)).unreadCount).toBe(1);
    expect(await markNotificationsRead(ben, {})).toEqual({ unreadCount: 0 });
  });

  it("marking read only affects the caller's own notifications", async () => {
    const ch = await openChannel();
    await send(anna, ch.id, `${tok(ben.userId)} ${tok(carla.userId)}`);
    const [n] = (await listNotifications(ben)).notifications;
    await markNotificationsRead(carla, { ids: [n.id] });
    expect((await listNotifications(ben)).unreadCount).toBe(1);
  });

  it("people who lost access to a private channel no longer see its notifications", async () => {
    const priv = await createChannel(anna, {
      name: "kern",
      description: "",
      visibility: "private",
      memberIds: [ben.userId],
    });
    await send(anna, priv.id, `${tok(ben.userId)} hi`);
    expect((await listNotifications(ben)).notifications).toHaveLength(1);
    const { removeChannelMember } = await import("../src/services/chat");
    await removeChannelMember(anna, { id: priv.id, userId: ben.userId, archive: false, newOwnerId: null });
    expect((await listNotifications(ben)).notifications).toHaveLength(0);
  });
});

describe("RLS on notifications", () => {
  it("users read only their own rows; anon nothing; no writes", async () => {
    const ch = await openChannel();
    await send(anna, ch.id, `${tok(ben.userId)} ${tok(carla.userId)}`);
    const own = await rls.asUser(ben.userId, (tx) => tx`select user_id from public.notifications`);
    expect(own.map((r) => r.user_id)).toEqual([ben.userId]);
    const none = await rls.asUser(null, (tx) => tx`select 1 from public.notifications`.catch(() => []));
    expect(none).toHaveLength(0);
    await expect(
      rls.asUser(ben.userId, (tx) => tx`update public.notifications set read_at = now()`),
    ).rejects.toThrow();
    const rows = await getDb().select().from(notifications).where(eq(notifications.userId, carla.userId));
    expect(rows).toHaveLength(1);
  });
});

describe("@all", () => {
  const recipients = async (...ctxs: AuthContext[]) =>
    Promise.all(ctxs.map(async (c) => (await listNotifications(c)).notifications.length));

  it("open channel: notifies every active member except the author, readable as @all", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `${ALL} Standup in 5`);
    expect(sent.markup).toBe(`${ALL} Standup in 5`);
    expect(sent.mentionIds).toEqual([]);
    expect(sent.body).toBe("@all Standup in 5");
    expect(await recipients(anna, ben, carla, outsider)).toEqual([0, 1, 1, 0]);
    expect((await listNotifications(ben)).notifications[0].preview).toBe("@all Standup in 5");
    expect((await messagePush(sent.id))?.message.body).toBe("@all Standup in 5");
  });

  it("private channel: only participants; removed members are skipped", async () => {
    const priv = await createChannel(anna, { name: "geheim", description: "", visibility: "private", memberIds: [ben.userId] });
    await send(anna, priv.id, `${ALL} hallo`);
    expect(await recipients(anna, ben, carla)).toEqual([0, 1, 0]);

    const ch = await openChannel();
    await removeMember(anna, carla.userId);
    await send(anna, ch.id, ALL);
    expect(await recipients(ben)).toEqual([2]);
  });

  it("does not count towards the per-message mention limit and combines with individual mentions", async () => {
    const ch = await openChannel();
    await send(anna, ch.id, `${ALL} ${tok(ben.userId)}`);
    expect(await recipients(ben, carla)).toEqual([1, 1]);
  });

  it("editing: adding @all notifies, keeping it does not repeat, removing it withdraws", async () => {
    const ch = await openChannel();
    const sent = await send(anna, ch.id, `kurz ${tok(ben.userId)}`);
    expect(await recipients(ben, carla)).toEqual([1, 0]);

    await editMessage(anna, { id: sent.id, body: `kurz ${tok(ben.userId)} ${ALL}` });
    expect(await recipients(ben, carla)).toEqual([1, 1]);
    await editMessage(anna, { id: sent.id, body: `kurz! ${tok(ben.userId)} ${ALL}` });
    expect(await recipients(ben, carla)).toEqual([1, 1]);

    await editMessage(anna, { id: sent.id, body: `kurz ${tok(ben.userId)}` });
    expect(await recipients(ben, carla)).toEqual([1, 0]);
  });
});
