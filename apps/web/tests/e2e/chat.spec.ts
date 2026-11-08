import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * Chat end-to-end: three real users in an isolated workspace (local stack only).
 * anna = admin, ben = member, carla = member who is NOT in the private channel.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  anna: { email: `anna-${run}@e2e.vistoo.test`, name: "Anna Admin", role: "admin" },
  ben: { email: `ben-${run}@e2e.vistoo.test`, name: "Ben Bauer", role: "member" },
  carla: { email: `carla-${run}@e2e.vistoo.test`, name: "Carla Cramer", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const ids = {} as Record<Who, string>;

async function open(browser: Browser, who: Who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE" });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

const composer = (p: Page) => p.getByRole("textbox", { name: /^Nachricht (in|an) / });
const messageList = (p: Page) => p.getByRole("list", { name: /^Nachrichten in / });

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-chat-" + run}) returning id`;
  for (const who of Object.keys(users) as Who[]) {
    const u = users[who];
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error) throw error;
    ids[who] = data.user.id;
    await sql`insert into profiles (id, email, full_name) values (${data.user.id}, ${u.email}, ${u.name})`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${data.user.id}, ${u.role})`;
  }
  await sql.end();
  pages.anna = await open(browser, "anna");
  pages.ben = await open(browser, "ben");
});

test("default channel, sending and realtime delivery with unread indicator", async () => {
  const { anna, ben } = pages;
  await ben.goto("/tasks"); // Ben is elsewhere in the app
  await anna.getByRole("link", { name: "Chat" }).first().click();
  await anna.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(anna.getByRole("heading", { level: 1, name: "Allgemein" })).toBeVisible();
  await ben.waitForTimeout(1500); // realtime subscriptions settle

  await composer(anna).fill("Hallo Team!\nZweite Zeile mit Link https://vistoo.de.");
  await composer(anna).press("Enter");
  await expect(messageList(anna).getByText("Hallo Team!")).toBeVisible();
  await expect(anna.getByText("Wird gesendet …")).toHaveCount(0);
  await expect(messageList(anna).getByRole("link", { name: "https://vistoo.de" })).toBeVisible();

  // Ben: dot on the global "Chat" entry without reload
  await expect(ben.getByRole("link", { name: /Chat.*ungelesene Nachrichten/ }).first()).toBeVisible({ timeout: 15_000 });
  await ben.getByRole("link", { name: /^Chat/ }).first().click();
  await expect(ben.getByRole("link", { name: /^Allgemein.*ungelesene Nachrichten/ })).toBeVisible();
  await ben.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(messageList(ben).getByText("Hallo Team!")).toBeVisible();
  await expect(ben.getByRole("link", { name: /Chat.*ungelesene/ })).toHaveCount(0, { timeout: 10_000 });

  // Live reply arrives at Anna without reload, exactly once
  await composer(ben).fill("Hi Anna");
  await composer(ben).press("Enter");
  await expect(messageList(anna).getByText("Hi Anna")).toHaveCount(1, { timeout: 15_000 });
});

test("Shift+Enter inserts a newline, overly long messages are rejected", async () => {
  const { anna } = pages;
  await composer(anna).fill("Zeile 1");
  await composer(anna).press("Shift+Enter");
  await composer(anna).pressSequentially("Zeile 2");
  await expect(composer(anna)).toHaveValue("Zeile 1\nZeile 2");
  await composer(anna).fill("x".repeat(10_001));
  await expect(anna.getByText(/Die Nachricht ist zu lang/)).toBeVisible();
  await expect(anna.getByRole("button", { name: "Senden" })).toBeDisabled();
  await composer(anna).fill("");
});

test("edit and delete own messages; others see the result live", async () => {
  const { anna, ben } = pages;
  await composer(anna).fill("Tippfehlr");
  await composer(anna).press("Enter");
  const row = messageList(anna).locator("li", { hasText: "Tippfehlr" });
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Aktionen für deine Nachricht" }).click();
  await anna.getByRole("menuitem", { name: "Bearbeiten" }).click();
  await anna.getByRole("textbox", { name: "Nachricht bearbeiten" }).fill("Tippfehler");
  await anna.getByRole("textbox", { name: "Nachricht bearbeiten" }).press("Enter");
  await expect(messageList(ben).getByText("Tippfehler")).toBeVisible({ timeout: 15_000 });
  await expect(messageList(ben).getByText("(bearbeitet)")).toBeVisible();

  const edited = messageList(anna).locator("li", { hasText: "Tippfehler" });
  await edited.hover();
  await edited.getByRole("button", { name: "Aktionen für deine Nachricht" }).click();
  await anna.getByRole("menuitem", { name: /Löschen/ }).click();
  await anna.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await expect(messageList(ben).getByText("Nachricht gelöscht")).toBeVisible({ timeout: 15_000 });
  await expect(messageList(ben).getByText("Tippfehler")).toHaveCount(0);
  // Ben has no actions on Anna's messages
  await expect(messageList(ben).getByRole("button", { name: "Aktionen für deine Nachricht" })).toHaveCount(
    await messageList(ben).locator("li", { hasText: "Hi Anna" }).getByRole("button", { name: "Aktionen für deine Nachricht" }).count(),
  );
});

test("failed send keeps the text and retries without duplicates", async () => {
  const { anna, ben } = pages;
  await anna.context().setOffline(true);
  await composer(anna).fill("Offline geschrieben");
  await composer(anna).press("Enter");
  await expect(anna.getByRole("button", { name: "Erneut senden" })).toBeVisible({ timeout: 20_000 });
  await anna.context().setOffline(false);
  await anna.getByRole("button", { name: "Erneut senden" }).click();
  await expect(anna.getByRole("button", { name: "Erneut senden" })).toHaveCount(0);
  await expect(messageList(ben).getByText("Offline geschrieben")).toHaveCount(1, { timeout: 15_000 });
  await ben.waitForTimeout(1000);
  await expect(messageList(anna).getByText("Offline geschrieben")).toHaveCount(1);
});

test("attachments: allowlist, upload, download access", async () => {
  const { anna, ben } = pages;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(200).fill(1)]);
  const input = anna.locator('input[type="file"]');
  await input.setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(anna.getByText(/Dieser Dateityp ist nicht erlaubt/)).toBeVisible();
  // A disguised file is rejected by the server-side signature check.
  await input.setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>nope</html>") });
  await expect(anna.getByText("Der Dateiinhalt passt nicht zum Dateityp.")).toBeVisible({ timeout: 15_000 });
  await anna.getByRole("button", { name: "„fake.pdf“ entfernen" }).click();

  await input.setInputFiles({ name: "Entwurf Ä.png", mimeType: "image/png", buffer: png });
  await expect(anna.getByRole("button", { name: "„Entwurf Ä.png“ entfernen" })).toBeVisible();
  await expect(anna.getByRole("progressbar")).toHaveCount(0, { timeout: 15_000 });
  await composer(anna).fill("Hier der Entwurf");
  await composer(anna).press("Enter");
  await expect(messageList(ben).getByText("Entwurf Ä.png")).toBeVisible({ timeout: 15_000 });

  const download = ben.waitForEvent("download");
  await messageList(ben).getByRole("button", { name: "„Entwurf Ä.png“ herunterladen" }).click();
  expect((await download).suggestedFilename()).toBe("Entwurf Ä.png");
});

test("private channel: only members see it; non-members get no access", async ({ browser }) => {
  const { anna, ben } = pages;
  await anna.getByRole("button", { name: "Kanal erstellen" }).click();
  const dlg = anna.getByRole("dialog");
  await dlg.getByLabel("Name").fill(`Geheim ${run}`);
  await dlg.getByRole("radio", { name: /Geschlossen/ }).click();
  await dlg.getByRole("option", { name: /Ben Bauer/ }).click();
  await dlg.getByRole("button", { name: "Kanal erstellen" }).click();
  await expect(anna.getByRole("heading", { level: 1, name: `Geheim ${run}` })).toBeVisible();
  const url = anna.url();
  await composer(anna).fill("Vertraulich");
  await composer(anna).press("Enter");

  await expect(ben.getByRole("link", { name: new RegExp(`^Geheim ${run}`) })).toBeVisible({ timeout: 15_000 });

  pages.carla = await open(browser, "carla");
  await pages.carla.goto("/chat");
  await expect(pages.carla.getByRole("link", { name: /^Allgemein/ })).toBeVisible();
  await expect(pages.carla.getByRole("link", { name: new RegExp(`^Geheim ${run}`) })).toHaveCount(0);
  await pages.carla.goto(url);
  await expect(pages.carla.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
  await expect(pages.carla.getByText("Vertraulich")).toHaveCount(0);

  // Ben is removed from the channel → loses access
  await ben.goto(url);
  await expect(messageList(ben).getByText("Vertraulich")).toBeVisible();
  await anna.getByRole("button", { name: "Details anzeigen" }).click();
  await anna.getByRole("dialog").locator("li", { hasText: "Ben Bauer" }).getByRole("button", { name: "Entfernen" }).click();
  await anna.getByRole("alertdialog").getByRole("button", { name: "Entfernen" }).click();
  await expect(anna.getByRole("dialog").locator("li", { hasText: "Ben Bauer" })).toHaveCount(0);
  await anna.getByRole("dialog").getByRole("button", { name: "Schließen" }).click();
  await expect(anna.getByRole("dialog")).toHaveCount(0);
  await composer(anna).fill("Nach dem Entfernen");
  await composer(anna).press("Enter");
  await ben.waitForTimeout(2000);
  await expect(ben.getByText("Nach dem Entfernen")).toHaveCount(0); // RLS blocks live delivery
  await ben.reload();
  await expect(ben.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
});

test("direct message: start once, visible only to the two participants", async () => {
  const { anna, ben, carla } = pages;
  await anna.getByRole("link", { name: /^Allgemein/ }).click();
  await anna.getByRole("button", { name: "Direktnachricht beginnen" }).click();
  await anna.getByRole("dialog").getByRole("option", { name: /Ben Bauer/ }).click();
  await expect(anna.getByRole("heading", { level: 1, name: "Ben Bauer" })).toBeVisible();
  const dmUrl = anna.url();
  await composer(anna).fill("Nur für dich");
  await composer(anna).press("Enter");

  // Starting again opens the same conversation
  await anna.getByRole("button", { name: "Direktnachricht beginnen" }).click();
  await anna.getByRole("dialog").getByRole("option", { name: /Ben Bauer/ }).click();
  await expect(anna).toHaveURL(dmUrl);

  await ben.goto("/chat");
  await expect(ben.getByRole("link", { name: /^Anna Admin/ })).toBeVisible({ timeout: 15_000 });
  await carla.goto(dmUrl);
  await expect(carla.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
});

test("mobile: list first, conversation as its own view with back navigation", async ({ browser }) => {
  const phone = await open(browser, "ben", { width: 390, height: 844 });
  await phone.goto("/chat");
  await phone.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(phone.getByRole("heading", { level: 1, name: "Allgemein" })).toBeVisible();
  await expect(phone.getByRole("navigation", { name: "Unterhaltungen" })).toBeHidden();
  await expect(phone.getByRole("button", { name: "Senden" })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await phone.goBack();
  await expect(phone.getByRole("navigation", { name: "Unterhaltungen" })).toBeVisible();
  await phone.close();
});

test("removed workspace member loses chat access immediately", async () => {
  const { anna, carla } = pages;
  await carla.goto("/chat");
  await carla.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(composer(carla)).toBeVisible();
  await anna.goto("/settings");
  await anna.getByRole("button", { name: "Aktionen für Carla Cramer" }).click();
  await anna.getByRole("menuitem", { name: /Aus dem Team entfernen/ }).click();
  await anna.getByRole("button", { name: "Entfernen" }).click();
  await expect(anna.getByText(users.carla.email, { exact: true })).toHaveCount(0);

  await composer(carla).fill(`zu spät ${randomUUID().slice(0, 4)}`);
  await composer(carla).press("Enter");
  await expect(carla.getByRole("button", { name: "Erneut senden" })).toBeVisible({ timeout: 15_000 });
  await carla.reload();
  await expect(carla).toHaveURL(/\/invite/);
});
