import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth";
import { resolveMembership } from "@/server/auth";
import type { ChatStorage } from "@/server/chat-storage";
import { getDb } from "@/server/db";
import { conversations, messageAttachments, messages } from "@/server/db/schema";
import {
  addChannelMembers,
  createChannel,
  deleteMessage,
  editMessage,
  getConversationDetail,
  listConversations,
  listMessages,
  markRead,
  openDm,
  removeChannelMember,
  sendMessage,
  setChannelArchived,
} from "@/server/services/chat";
import {
  cleanupChatFiles,
  discardUpload,
  finalizeUpload,
  getDownloadUrl,
  reserveUpload,
  setChatStorageForTests,
} from "@/server/services/chat-files";
import { removeMember } from "@/server/services/team";
import { testDatabaseUrl } from "./support/db-url";
import { makeMemberCtx, makeWorkspace } from "./support/fixtures";

// ---- in-memory storage --------------------------------------------------
const objects = new Map<string, Uint8Array>();
const memoryStorage: ChatStorage = {
  async createUploadUrl(path) {
    return { signedUrl: `memory://${path}`, token: "t" };
  },
  async inspect(path) {
    const data = objects.get(path);
    return data ? { size: data.length, head: data.slice(0, 4096) } : null;
  },
  async remove(paths) {
    for (const p of paths) objects.delete(p);
  },
  async createDownloadUrl(path) {
    return `memory://download/${path}`;
  },
};
setChatStorageForTests(memoryStorage);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
async function storedPath(attachmentId: string) {
  const [row] = await getDb().select().from(messageAttachments).where(eq(messageAttachments.id, attachmentId));
  return row;
}
async function upload(ctx: AuthContext, conversationId: string, name = "bild.png", bytes = PNG) {
  const ticket = await reserveUpload(ctx, { conversationId, fileName: name, sizeBytes: bytes.length });
  objects.set((await storedPath(ticket.attachmentId)).storagePath, bytes);
  await finalizeUpload(ctx, ticket.attachmentId);
  return ticket.attachmentId;
}

const send = (ctx: AuthContext, conversationId: string, body: string, extra: { id?: string; attachmentIds?: string[] } = {}) =>
  sendMessage(ctx, { id: extra.id ?? randomUUID(), conversationId, body, attachmentIds: extra.attachmentIds ?? [] });

let wsId: string;
let admin: AuthContext;
let anna: AuthContext;
let ben: AuthContext;

beforeEach(async () => {
  delete process.env.CHAT_STORAGE_BUDGET_MB;
  const ws = await makeWorkspace();
  wsId = ws.id;
  admin = (await makeMemberCtx(ws.id, "admin")).ctx;
  anna = (await makeMemberCtx(ws.id, "member")).ctx;
  ben = (await makeMemberCtx(ws.id, "member")).ctx;
});

describe("channels and access", () => {
  it("creates the default channel idempotently", async () => {
    await listConversations(anna);
    const list = await listConversations(ben);
    expect(list.filter((c) => c.isDefault)).toHaveLength(1);
    expect(list.find((c) => c.isDefault)?.title).toBe("Allgemein");
  });

  it("open channels are visible to all members; private only to participants (not admins)", async () => {
    const open = await createChannel(anna, { name: "Design", description: "", visibility: "open", memberIds: [] });
    const priv = await createChannel(anna, { name: "Geheim", description: "", visibility: "private", memberIds: [] });
    await send(anna, priv.id, "nur für uns");

    expect((await listConversations(ben)).map((c) => c.id)).toContain(open.id);
    expect((await listConversations(ben)).map((c) => c.id)).not.toContain(priv.id);
    expect((await listConversations(admin)).map((c) => c.id)).not.toContain(priv.id);
    await expect(listMessages(admin, { conversationId: priv.id, beforeSeq: null, afterSeq: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(send(admin, priv.id, "hallo?")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await addChannelMembers(anna, { id: priv.id, userIds: [ben.userId] });
    const page = await listMessages(ben, { conversationId: priv.id, beforeSeq: null, afterSeq: null });
    expect(page.messages.map((m) => m.body)).toEqual(["nur für uns"]); // history visible to new members
  });

  it("other workspaces cannot see open channels", async () => {
    const open = await createChannel(anna, { name: "Intern", description: "", visibility: "open", memberIds: [] });
    const other = (await makeMemberCtx((await makeWorkspace("Fremd")).id, "admin")).ctx;
    await expect(getConversationDetail(other, open.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("management rules: owner and admins (open); admins only as members (private)", async () => {
    const open = await createChannel(anna, { name: "Offen", description: "", visibility: "open", memberIds: [] });
    expect((await getConversationDetail(admin, open.id)).canManage).toBe(true);
    expect((await getConversationDetail(ben, open.id)).canManage).toBe(false);
    await expect(setChannelArchived(ben, { id: open.id, archived: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const priv = await createChannel(anna, { name: "Privat", description: "", visibility: "private", memberIds: [admin.userId] });
    expect((await getConversationDetail(admin, priv.id)).canManage).toBe(true);
  });

  it("archived channels stay readable but reject new messages", async () => {
    const ch = await createChannel(anna, { name: "Alt", description: "", visibility: "open", memberIds: [] });
    await send(anna, ch.id, "vorher");
    await setChannelArchived(anna, { id: ch.id, archived: true });
    await expect(send(ben, ch.id, "nachher")).rejects.toMatchObject({ code: "ARCHIVED" });
    expect((await listMessages(ben, { conversationId: ch.id, beforeSeq: null, afterSeq: null })).messages).toHaveLength(1);
    await setChannelArchived(anna, { id: ch.id, archived: false });
    await send(ben, ch.id, "wieder offen");
  });

  it("the responsible member must hand over or archive before leaving", async () => {
    const priv = await createChannel(anna, { name: "Team", description: "", visibility: "private", memberIds: [ben.userId] });
    await expect(
      removeChannelMember(anna, { id: priv.id, userId: anna.userId, newOwnerId: null, archive: false }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await removeChannelMember(anna, { id: priv.id, userId: anna.userId, newOwnerId: ben.userId, archive: false });
    const detail = await getConversationDetail(ben, priv.id);
    expect(detail.ownerId).toBe(ben.userId);
    await expect(getConversationDetail(anna, priv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("direct messages", () => {
  it("exactly one DM per pair, even when started concurrently", async () => {
    const [a, b] = await Promise.all([openDm(anna, ben.userId), openDm(ben, anna.userId)]);
    expect(a.id).toBe(b.id);
    const rows = await getDb().select().from(conversations).where(eq(conversations.dmKey, [anna.userId, ben.userId].sort().join(":")));
    expect(rows).toHaveLength(1);
  });

  it("no self DMs; third parties and admins have no access", async () => {
    await expect(openDm(anna, anna.userId)).rejects.toMatchObject({ code: "VALIDATION" });
    const dm = await openDm(anna, ben.userId);
    await send(anna, dm.id, "privat");
    await expect(listMessages(admin, { conversationId: dm.id, beforeSeq: null, afterSeq: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await listConversations(admin)).map((c) => c.id)).not.toContain(dm.id);
    expect((await listConversations(ben)).find((c) => c.id === dm.id)?.title).toBeTruthy();
  });

  it("removing a workspace member: access ends, history stays, DM becomes read-only", async () => {
    const dm = await openDm(anna, ben.userId);
    await send(ben, dm.id, "Hallo Anna");
    const priv = await createChannel(ben, { name: "Bens Kanal", description: "", visibility: "private", memberIds: [anna.userId] });
    await removeMember(admin, ben.userId);

    expect(await resolveMembership({ id: ben.userId, email: ben.email })).toBeNull();
    const detail = await getConversationDetail(anna, dm.id);
    expect(detail.canPost).toBe(false);
    expect(detail.readOnlyReason).toBe("inactive_partner");
    expect((await listMessages(anna, { conversationId: dm.id, beforeSeq: null, afterSeq: null })).messages).toHaveLength(1);
    await expect(send(anna, dm.id, "noch da?")).rejects.toMatchObject({ code: "ARCHIVED" });
    // private channel responsibility moved to the remaining member
    expect((await getConversationDetail(anna, priv.id)).ownerId).toBe(anna.userId);
  });
});

describe("messages", () => {
  it("sending is idempotent per client id", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const id = randomUUID();
    const [m1, m2] = await Promise.all([send(anna, ch.id, "einmal", { id }), send(anna, ch.id, "einmal", { id })].map((p) => p.catch((e) => e)));
    const ok = [m1, m2].filter((m) => !(m instanceof Error));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await send(anna, ch.id, "einmal", { id });
    expect(again.id).toBe(id);
    const page = await listMessages(anna, { conversationId: ch.id, beforeSeq: null, afterSeq: null });
    expect(page.messages.filter((m) => m.id === id)).toHaveLength(1);
    // Someone else cannot hijack the id
    await expect(send(ben, ch.id, "fremd", { id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates length and emptiness", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    await expect(send(anna, ch.id, "   ")).rejects.toMatchObject({ code: "VALIDATION" });
    const { sendMessageSchema } = await import("@/lib/validation");
    expect(sendMessageSchema.safeParse({ id: randomUUID(), conversationId: ch.id, body: "x".repeat(10_001) }).success).toBe(false);
  });

  it("only the author edits or deletes; deleted messages keep a placeholder", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const m = await send(anna, ch.id, "Tippfehlr");
    await expect(editMessage(ben, { id: m.id, body: "gehackt" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteMessage(ben, m.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const edited = await editMessage(anna, { id: m.id, body: "Tippfehler" });
    expect(edited.editedAt).not.toBeNull();
    const deleted = await deleteMessage(anna, m.id);
    expect(deleted).toMatchObject({ deleted: true, body: "" });
    const [row] = await getDb().select().from(messages).where(eq(messages.id, m.id));
    expect(row.body).toBe("");
  });

  it("paginates with a stable cursor", async () => {
    const ch = await createChannel(anna, { name: "Viel", description: "", visibility: "open", memberIds: [] });
    for (let i = 0; i < 120; i++) await send(anna, ch.id, `#${i}`);
    const first = await listMessages(anna, { conversationId: ch.id, beforeSeq: null, afterSeq: null });
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.messages.at(-1)?.body).toBe("#119");
    const second = await listMessages(anna, { conversationId: ch.id, beforeSeq: first.messages[0].seq, afterSeq: null });
    expect(second.messages.at(-1)?.body).toBe("#69");
    const third = await listMessages(anna, { conversationId: ch.id, beforeSeq: second.messages[0].seq, afterSeq: null });
    expect(third.messages).toHaveLength(20);
    expect(third.hasMore).toBe(false);
    const resync = await listMessages(anna, { conversationId: ch.id, beforeSeq: null, afterSeq: first.messages[47].seq });
    expect(resync.messages.map((m) => m.body)).toEqual(["#118", "#119"]);
  });

  it("read state only moves forward; unread reflects new messages", async () => {
    const ch = await createChannel(anna, { name: "Lesen", description: "", visibility: "open", memberIds: [] });
    const m1 = await send(anna, ch.id, "eins");
    expect((await listConversations(ben)).find((c) => c.id === ch.id)?.unread).toBe(true);
    expect((await listConversations(anna)).find((c) => c.id === ch.id)?.unread).toBe(false); // own message
    await markRead(ben, { conversationId: ch.id, seq: m1.seq });
    expect((await listConversations(ben)).find((c) => c.id === ch.id)?.unread).toBe(false);
    await markRead(ben, { conversationId: ch.id, seq: 0 });
    expect((await listConversations(ben)).find((c) => c.id === ch.id)?.lastReadSeq).toBe(m1.seq);
    await markRead(ben, { conversationId: ch.id, seq: m1.seq + 1000 }); // clamped
    expect((await listConversations(ben)).find((c) => c.id === ch.id)?.lastReadSeq).toBe(m1.seq);
  });
});

describe("attachments", () => {
  it("allows only allowlisted types and sizes", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    await expect(reserveUpload(anna, { conversationId: ch.id, fileName: "x.svg", sizeBytes: 10 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reserveUpload(anna, { conversationId: ch.id, fileName: "x.exe", sizeBytes: 10 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      reserveUpload(anna, { conversationId: ch.id, fileName: "gross.pdf", sizeBytes: 10 * 1024 * 1024 + 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects content that does not match the declared type and frees the space", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const ticket = await reserveUpload(anna, { conversationId: ch.id, fileName: "fake.pdf", sizeBytes: 5 });
    const row = await storedPath(ticket.attachmentId);
    objects.set(row.storagePath, new TextEncoder().encode("<html>"));
    await expect(finalizeUpload(anna, ticket.attachmentId)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(objects.has(row.storagePath)).toBe(false);
    expect(await storedPath(ticket.attachmentId)).toBeUndefined();
  });

  it("rejects files larger than reserved", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const ticket = await reserveUpload(anna, { conversationId: ch.id, fileName: "a.txt", sizeBytes: 3 });
    objects.set((await storedPath(ticket.attachmentId)).storagePath, new TextEncoder().encode("viel mehr als drei"));
    await expect(finalizeUpload(anna, ticket.attachmentId)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("budget holds under parallel reservations", async () => {
    process.env.CHAT_STORAGE_BUDGET_MB = "1";
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const size = 400 * 1024;
    const results = await Promise.allSettled(
      [anna, ben, anna, ben].map((c, i) => reserveUpload(c, { conversationId: ch.id, fileName: `f${i}.pdf`, sizeBytes: size })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });

  it("full flow: send with attachment, access-checked download, delete frees storage", async () => {
    const priv = await createChannel(anna, { name: "Dateien", description: "", visibility: "private", memberIds: [ben.userId] });
    const attId = await upload(anna, priv.id);
    const msg = await send(anna, priv.id, "", { attachmentIds: [attId] });
    expect(msg.attachments).toHaveLength(1);
    expect((await getDownloadUrl(ben, attId)).url).toContain("memory://download/");
    await expect(getDownloadUrl(admin, attId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another user cannot attach someone else's upload
    const foreign = await upload(anna, priv.id, "zwei.png");
    await expect(send(ben, priv.id, "klau", { attachmentIds: [foreign] })).rejects.toMatchObject({ code: "VALIDATION" });

    const path = (await storedPath(attId)).storagePath;
    await deleteMessage(anna, msg.id);
    expect(objects.has(path)).toBe(false);
    expect(await storedPath(attId)).toBeUndefined();
  });

  it("a member removed before finalizing cannot publish the upload", async () => {
    const priv = await createChannel(anna, { name: "Kurz", description: "", visibility: "private", memberIds: [ben.userId] });
    const ticket = await reserveUpload(ben, { conversationId: priv.id, fileName: "b.png", sizeBytes: PNG.length });
    const path = (await storedPath(ticket.attachmentId)).storagePath;
    objects.set(path, PNG);
    await removeChannelMember(anna, { id: priv.id, userId: ben.userId, newOwnerId: null, archive: false });
    await expect(finalizeUpload(ben, ticket.attachmentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(objects.has(path)).toBe(false);
  });

  it("discarded and expired uploads are cleaned up", async () => {
    const ch = (await listConversations(anna)).find((c) => c.isDefault)!;
    const kept = await upload(anna, ch.id);
    await discardUpload(anna, kept);
    expect(await storedPath(kept)).toBeUndefined();

    const ticket = await reserveUpload(anna, { conversationId: ch.id, fileName: "x.png", sizeBytes: PNG.length });
    await getDb()
      .update(messageAttachments)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(messageAttachments.id, ticket.attachmentId));
    await cleanupChatFiles({ workspaceId: wsId });
    expect(await storedPath(ticket.attachmentId)).toBeUndefined();
  });
});

describe("row level security for chat (Realtime / Data API)", () => {
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let out: T;
    await sql
      .begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        out = await fn(tx);
        throw new Error("rollback");
      })
      .catch((e) => {
        if ((e as Error).message !== "rollback") throw e;
      });
    return out!;
  }

  it("private messages reach participants only", async () => {
    const priv = await createChannel(anna, { name: "RLS", description: "", visibility: "private", memberIds: [] });
    await send(anna, priv.id, "geheim");
    const open = (await listConversations(anna)).find((c) => c.isDefault)!;
    await send(anna, open.id, "für alle");

    const count = (id: string, conv: string) =>
      asUser(id, (tx) => tx`select count(*)::int n from messages where conversation_id = ${conv}`).then((r) => r[0].n);
    expect(await count(anna.userId, priv.id)).toBe(1);
    expect(await count(admin.userId, priv.id)).toBe(0);
    expect(await count(ben.userId, priv.id)).toBe(0);
    expect(await count(ben.userId, open.id)).toBe(1);
    await expect(asUser(anna.userId, (tx) => tx`select * from message_attachments`)).rejects.toThrow(/permission denied/);
    await expect(asUser(anna.userId, (tx) => tx`update messages set body = 'x'`)).rejects.toThrow(/permission denied/);
  });
});
