import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { card, codeFrom, column, latestMail, loginWithCode } from "./support";

/**
 * Web ↔ iOS end to end against the local stack.
 *
 * "Web" is the real web app in a browser. "iOS" is a client that speaks
 * exactly the protocol of the native app: it requests the code through
 * /api/v1/auth/login-code, verifies it directly with Supabase Auth (as
 * supabase-swift does), and then calls the versioned HTTP API with the
 * access token as bearer — no cookies, no Server Actions.
 *
 * The SwiftUI app itself is not driven here (no simulator in this
 * environment); its client logic is covered by the VistooKit unit tests.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const run = Date.now().toString(36);
const users = {
  anna: { email: `anna-xp-${run}@e2e.vistoo.test`, name: "Anna Admin", role: "admin" },
  ben: { email: `ben-xp-${run}@e2e.vistoo.test`, name: "Ben Bauer", role: "member" },
  carla: { email: `carla-xp-${run}@e2e.vistoo.test`, name: "Carla Cramer", role: "member" },
  dora: { email: `dora-xp-${run}@e2e.vistoo.test`, name: "Dora Fremd", role: "admin" },
} as const;
type Who = keyof typeof users;
const ids = {} as Record<Who, string>;
const tokens = {} as Record<Who, string>;
let web: Page;
let sql: postgres.Sql;
let projectId: string;
let taskId: string;
let generalId: string;

type ApiResult = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** HTTP call exactly as the iOS app makes it. */
async function ios(who: Who | null, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const headers: Record<string, string> = { "x-vistoo-client": "ios/1", accept: "application/json" };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Native sign-in: code via the API, verification with Supabase Auth (like supabase-swift). */
async function iosSignIn(who: Who) {
  const since = Date.now();
  const res = await ios(null, "POST", "/auth/login-code", { email: users[who].email });
  expect(res.status).toBe(202);
  const mail = await latestMail(users[who].email, since);
  const meta = (await ios(null, "GET", "/meta")).body;
  const supabase = createClient(meta.supabaseUrl, meta.supabasePublishableKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.verifyOtp({ email: users[who].email, token: codeFrom(mail.text), type: "email" });
  if (error || !data.session) throw error ?? new Error("no session");
  tokens[who] = data.session.access_token;
}

async function openWeb(browser: Browser, who: Who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

const messageList = (p: Page) => p.getByRole("list", { name: /^Nachrichten in / });
const composer = (p: Page) => p.getByRole("textbox", { name: /^Nachricht (in|an) / });

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-xp-" + run}) returning id`;
  const [foreign] = await sql`insert into workspaces (name, slug) values ('Fremd', ${"e2e-xp-foreign-" + run}) returning id`;
  for (const who of Object.keys(users) as Who[]) {
    const u = users[who];
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error) throw error;
    ids[who] = data.user.id;
    await sql`insert into profiles (id, email, full_name) values (${data.user.id}, ${u.email}, ${u.name})`;
    const target = who === "dora" ? foreign.id : ws.id;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${target}, ${data.user.id}, ${u.role})`;
  }
  web = await openWeb(browser, "anna");
});

test.afterAll(async () => {
  await sql?.end();
});

test("1. the same account signs in on web and iOS", async () => {
  await web.waitForTimeout(1100); // Supabase allows one code per address per second
  for (const who of ["anna", "ben", "carla", "dora"] as Who[]) await iosSignIn(who);
  const me = await ios("anna", "GET", "/me");
  expect(me.status).toBe(200);
  expect(me.body.access).toBe("member");
  expect(me.body.viewer.userId).toBe(ids.anna);
  // The web session belongs to the same user.
  await web.goto("/settings");
  await expect(web.getByText(users.anna.email).first()).toBeVisible();
});

test("2. project from iOS shows on the web; task from the web is edited on iOS and updates live", async () => {
  projectId = randomUUID();
  const created = await ios("anna", "POST", "/projects", { id: projectId, name: `XP Projekt ${run}`, color: "teal" });
  expect(created.status).toBe(201);

  await web.goto(`/projects/${projectId}`);
  await expect(web.getByRole("heading", { name: `XP Projekt ${run}` })).toBeVisible();
  await web.getByRole("button", { name: "Aufgabe erstellen" }).first().click();
  const panel = web.getByRole("dialog");
  await panel.getByLabel("Titel").fill("Vom Web");
  await panel.getByRole("button", { name: "Erstellen" }).click();
  await expect(card(web, "Vom Web")).toBeVisible();
  await web.waitForTimeout(1500); // realtime subscription settles

  const list = await ios("ben", "GET", `/tasks?projectId=${projectId}`);
  const task = list.body.tasks.find((t: { title: string }) => t.title === "Vom Web");
  expect(task).toBeTruthy();
  taskId = task.id;
  const patched = await ios("ben", "PATCH", `/tasks/${taskId}`, {
    expectedVersion: task.version,
    patch: { title: "Vom Web, auf iOS bearbeitet", status: "in_progress", assigneeId: ids.ben, startDate: "2026-11-09", endDate: "2026-11-13" },
  });
  expect(patched.status).toBe(200);

  // Web: no reload — realtime brings the change into the right column.
  await expect(column(web, "In Arbeit").getByText("Vom Web, auf iOS bearbeitet")).toBeVisible({ timeout: 15_000 });
});

test("3. status, filter and timeline agree on both platforms", async () => {
  const done = await ios("ben", "PUT", `/tasks/${taskId}/status`, { status: "done" });
  expect(done.body.status).toBe("done");
  await expect(column(web, "Erledigt").getByText("Vom Web, auf iOS bearbeitet")).toBeVisible({ timeout: 15_000 });

  // Web changes the status back via the card menu; iOS reads it.
  await web.getByRole("button", { name: "Aktionen für „Vom Web, auf iOS bearbeitet“" }).first().click();
  await web.getByRole("menuitem", { name: "Status ändern" }).click();
  await web.getByRole("menuitemradio", { name: "Im Review" }).click();
  await expect(column(web, "Im Review").getByText("Vom Web, auf iOS bearbeitet")).toBeVisible();
  await expect.poll(async () => (await ios("ben", "GET", `/tasks/${taskId}`)).body.status).toBe("in_review");

  // Filter by the person assigned on iOS, then the timeline shows the exact calendar days.
  await web.goto(`/projects/${projectId}?assignee=${ids.ben}&view=timeline`);
  await expect(web.getByText(/Montag, 9\. November 2026 bis Freitag, 13\. November 2026/)).toBeAttached();
});

test("4. channel messages and DMs between web and iOS", async () => {
  await web.goto("/chat");
  await web.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(web.getByRole("heading", { level: 1, name: "Allgemein" })).toBeVisible();
  await web.waitForTimeout(1500);

  const conversations = (await ios("ben", "GET", "/conversations")).body.conversations;
  generalId = conversations.find((c: { isDefault: boolean }) => c.isDefault).id;
  const sent = await ios("ben", "PUT", `/conversations/${generalId}/messages/${randomUUID()}`, { body: "Grüße vom iPhone" });
  expect(sent.status).toBe(200);
  await expect(messageList(web).getByText("Grüße vom iPhone")).toHaveCount(1, { timeout: 15_000 });

  await composer(web).fill("Antwort aus dem Web");
  await composer(web).press("Enter");
  await expect(web.getByText("Wird gesendet …")).toHaveCount(0);
  const page = await ios("ben", "GET", `/conversations/${generalId}/messages?afterSeq=${sent.body.seq}`);
  expect(page.body.messages.map((m: { body: string }) => m.body)).toContain("Antwort aus dem Web");

  // Unread state is shared: Ben (iOS) has unread until he marks it read.
  let general = (await ios("ben", "GET", "/conversations")).body.conversations.find((c: { id: string }) => c.id === generalId);
  expect(general.unread).toBe(true);
  await ios("ben", "PUT", `/conversations/${generalId}/read`, { seq: page.body.messages.at(-1).seq });
  general = (await ios("ben", "GET", "/conversations")).body.conversations.find((c: { id: string }) => c.id === generalId);
  expect(general.unread).toBe(false);

  // DM started on iOS appears on the web as unread.
  const dm = await ios("ben", "POST", "/conversations/direct", { userId: ids.anna });
  await ios("ben", "PUT", `/conversations/${dm.body.id}/messages/${randomUUID()}`, { body: "Direkt vom iPhone" });
  await expect(web.getByRole("link", { name: /^Ben Bauer.*ungelesene Nachrichten/ })).toBeVisible({ timeout: 15_000 });
  await web.getByRole("link", { name: /^Ben Bauer/ }).click();
  await expect(messageList(web).getByText("Direkt vom iPhone")).toBeVisible();
});

test("5. a file uploaded on iOS opens on the web and vice versa (same limits)", async () => {
  await web.goto(`/chat/${generalId}`);
  await web.waitForTimeout(1500);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(300).fill(7)]);

  // Limits are enforced for the native client as well.
  const tooBig = await ios("ben", "POST", `/conversations/${generalId}/uploads`, { fileName: "riesig.png", sizeBytes: 11 * 1024 * 1024 });
  expect(tooBig.status).toBe(422);
  const svg = await ios("ben", "POST", `/conversations/${generalId}/uploads`, { fileName: "bild.svg", sizeBytes: 10 });
  expect(svg.status).toBe(422);

  const ticket = await ios("ben", "POST", `/conversations/${generalId}/uploads`, { fileName: "foto-iphone.png", sizeBytes: png.length });
  expect(ticket.status).toBe(201);
  const put = await fetch(ticket.body.signedUrl, {
    method: "PUT",
    headers: { "content-type": ticket.body.contentType, "x-upsert": "false" },
    body: png,
  });
  expect(put.ok).toBe(true);
  expect((await ios("ben", "POST", `/uploads/${ticket.body.attachmentId}/finalize`)).status).toBe(200);
  await ios("ben", "PUT", `/conversations/${generalId}/messages/${randomUUID()}`, { body: "Foto", attachmentIds: [ticket.body.attachmentId] });

  await expect(messageList(web).getByText("foto-iphone.png")).toBeVisible({ timeout: 15_000 });
  const download = web.waitForEvent("download");
  await messageList(web).getByRole("button", { name: "„foto-iphone.png“ herunterladen" }).click();
  expect((await download).suggestedFilename()).toBe("foto-iphone.png");

  // Web → iOS
  const pdf = Buffer.from("%PDF-1.4\n% Vistoo\n");
  await web.locator('input[type="file"]').setInputFiles({ name: "Angebot.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(web.getByRole("progressbar")).toHaveCount(0, { timeout: 15_000 });
  await composer(web).fill("Angebot anbei");
  await composer(web).press("Enter");
  await expect(web.getByText("Wird gesendet …")).toHaveCount(0);
  const latest = await ios("ben", "GET", `/conversations/${generalId}/messages`);
  const attachment = latest.body.messages.flatMap((m: { attachments: { fileName: string }[] }) => m.attachments).find((a: { fileName: string }) => a.fileName === "Angebot.pdf");
  const link = await ios("ben", "GET", `/attachments/${attachment.id}/download`);
  expect(link.body.expiresInSeconds).toBe(60);
  const bytes = Buffer.from(await (await fetch(link.body.url)).arrayBuffer());
  expect(bytes.equals(pdf)).toBe(true);
});

test("6. closed channels and foreign workspaces stay closed to the native client", async () => {
  const closed = await ios("ben", "POST", "/conversations/channels", {
    id: randomUUID(),
    name: `Intern ${run}`,
    visibility: "private",
    memberIds: [ids.anna],
  });
  expect(closed.status).toBe(201);
  // Carla is in the workspace but not in the channel.
  expect((await ios("carla", "GET", `/conversations/${closed.body.id}`)).status).toBe(404);
  expect((await ios("carla", "GET", `/conversations/${closed.body.id}/messages`)).status).toBe(404);
  // Dora belongs to another workspace: nothing of this workspace exists for her.
  expect((await ios("dora", "GET", `/tasks/${taskId}`)).status).toBe(404);
  expect((await ios("dora", "GET", `/projects/${projectId}`)).status).toBe(404);
  expect((await ios("dora", "GET", `/conversations/${generalId}`)).status).toBe(404);
  const doraPatch = await ios("dora", "PUT", `/tasks/${taskId}/status`, { status: "open" });
  expect(doraPatch.status).toBe(404);
});

test("7. removing a member on the web revokes the native session's access immediately", async () => {
  expect((await ios("carla", "GET", "/tasks")).status).toBe(200);
  await web.goto("/settings");
  await web.getByRole("button", { name: "Aktionen für Carla Cramer" }).click();
  await web.getByRole("menuitem", { name: /Aus dem Team entfernen/ }).click();
  await web.getByRole("button", { name: "Entfernen" }).click();
  await expect(web.getByText(users.carla.email, { exact: true })).toHaveCount(0);

  const after = await ios("carla", "GET", "/tasks");
  expect(after.status).toBe(403);
  expect(after.body.error.code).toBe("FORBIDDEN");
  expect((await ios("carla", "GET", "/me")).body.access).toBe("none");
});

test("8. after a reconnect the client fetches exactly what it missed", async () => {
  const before = await ios("ben", "GET", `/conversations/${generalId}/messages`);
  const lastSeq = before.body.messages.at(-1).seq;
  // "Offline" on iOS: three messages arrive on the web meanwhile.
  await web.goto(`/chat/${generalId}`);
  for (const text of ["Verpasst 1", "Verpasst 2", "Verpasst 3"]) {
    await composer(web).fill(text);
    await composer(web).press("Enter");
    await expect(web.getByText("Wird gesendet …")).toHaveCount(0);
  }
  const missed = await ios("ben", "GET", `/conversations/${generalId}/messages?afterSeq=${lastSeq}`);
  expect(missed.body.messages.map((m: { body: string }) => m.body)).toEqual(["Verpasst 1", "Verpasst 2", "Verpasst 3"]);
});

test("9. repeated mutations after network errors never duplicate", async () => {
  const id = randomUUID();
  const body = { id, projectId, title: "Genau einmal" };
  const results = await Promise.all([ios("ben", "POST", "/tasks", body), ios("ben", "POST", "/tasks", body)]);
  expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
  expect((await ios("ben", "POST", "/tasks", body)).status).toBe(201);
  expect((await sql`select count(*)::int as n from tasks where id = ${id}`)[0].n).toBe(1);

  const messageId = randomUUID();
  await Promise.all([
    ios("ben", "PUT", `/conversations/${generalId}/messages/${messageId}`, { body: "Einmal" }),
    ios("ben", "PUT", `/conversations/${generalId}/messages/${messageId}`, { body: "Einmal" }),
  ]);
  expect((await sql`select count(*)::int as n from messages where id = ${messageId}`)[0].n).toBe(1);
  await expect(web.getByText("Einmal", { exact: true })).toHaveCount(1, { timeout: 15_000 });
});

test("10. @mentions: iOS markup shows on the web, web mentions notify the iOS user", async () => {
  // iOS sends the stored format (<@id>); old builds still get a readable body.
  const sent = await ios("ben", "PUT", `/conversations/${generalId}/messages/${randomUUID()}`, {
    body: `Hallo <@${ids.anna}>, vom iPhone`,
  });
  expect(sent.status).toBe(200);
  expect(sent.body.body).toBe("Hallo @Anna Admin, vom iPhone");
  expect(sent.body.markup).toBe(`Hallo <@${ids.anna}>, vom iPhone`);
  expect(sent.body.mentionIds).toEqual([ids.anna]);

  await web.goto(`/chat/${generalId}`);
  const fromIos = messageList(web).getByRole("listitem").filter({ hasText: "vom iPhone" }).last();
  await expect(fromIos.locator("[data-mention]")).toHaveText("@Anna Admin");

  // Web mention → in-app notification for the iOS user via /me/notifications.
  await composer(web).pressSequentially("Danke @be");
  await web.getByRole("option", { name: /Ben Bauer/ }).click();
  await composer(web).press("Enter");
  await expect(web.getByText("Wird gesendet …")).toHaveCount(0);
  const inbox = await ios("ben", "GET", "/me/notifications");
  expect(inbox.status).toBe(200);
  expect(inbox.body.unreadCount).toBe(1);
  expect(inbox.body.notifications[0]).toMatchObject({
    kind: "mention",
    conversationId: generalId,
    conversationTitle: "Allgemein",
    actor: { userId: ids.anna },
    preview: "Danke @Ben Bauer",
    readAt: null,
  });
  const read = await ios("ben", "POST", "/me/notifications/read", {});
  expect(read.body).toEqual({ unreadCount: 0 });

  // A forged mention of someone from another workspace is rejected for both clients.
  const forged = await ios("ben", "PUT", `/conversations/${generalId}/messages/${randomUUID()}`, {
    body: `<@${ids.dora}>`,
  });
  expect(forged.status).toBe(422);
  expect(forged.body.error.code).toBe("VALIDATION");
});
