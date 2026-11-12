import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * Meetings end to end: two real users in an isolated workspace (local stack
 * only). simon = admin, felix = member. The browsers run in Pacific/Auckland
 * (see playwright.config.ts); meeting times are entered and shown in the
 * team's time zone (Europe/Berlin) regardless.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  simon: { email: `simon-mtg-${run}@e2e.vistoo.test`, name: "Simon Gründer", role: "admin" },
  felix: { email: `felix-mtg-${run}@e2e.vistoo.test`, name: "Felix Partner", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const SHOTS = process.env.E2E_SCREENSHOTS;
let meetingUrl = "";
const consoleErrors: string[] = [];

async function open(browser: Browser, who: Who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE", timezoneId: "Pacific/Auckland" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${who}] ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`[${who}] ${e.message}`));
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

const items = (page: Page) => page.getByRole("list", { name: "Agenda-Punkte" }).filter({ visible: true }).getByRole("listitem");
const item = (page: Page, title: string) => items(page).filter({ has: page.getByRole("heading", { name: title }) });
const itemMenu = (page: Page, title: string) => page.getByRole("button", { name: `Aktionen für „${title}“` });
const agendaTitles = async (page: Page) =>
  (await page.getByRole("list", { name: "Agenda-Punkte" }).getByRole("heading", { level: 3 }).allTextContents()).map((t) =>
    t.replace(/^\d+\.\s*/, ""),
  );
const addPoint = async (page: Page, title: string) => {
  await page.getByLabel("Neuer Agenda-Punkt").fill(title);
  await page.keyboard.press("Enter");
  // Saved (the actions menu appears once the server confirmed the point).
  await expect(itemMenu(page, title)).toBeVisible();
};

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug, meeting_url)
    values ('Vistoo', ${"e2e-mtg-" + run}, 'https://discord.com/channels/1/2') returning id`;
  await sql`insert into projects (workspace_id, name, color) values (${ws.id}, 'Website', 'blue')`;
  for (const who of Object.keys(users) as Who[]) {
    const u = users[who];
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error) throw error;
    await sql`insert into profiles (id, email, full_name) values (${data.user.id}, ${u.email}, ${u.name})`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${data.user.id}, ${u.role})`;
  }
  await sql.end();
  pages.simon = await open(browser, "simon");
  pages.felix = await open(browser, "felix");
});

test.afterAll(async () => {
  await Promise.all(Object.values(pages).map((p) => p.context().close()));
});

test("plan a meeting in seconds (team time zone, participants, link)", async () => {
  const page = pages.simon;
  await page.getByRole("link", { name: "Meetings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Meetings", level: 1 })).toBeVisible();
  await expect(page.getByText("Noch keine Meetings")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-empty.png` });

  await page.getByRole("button", { name: "Neues Meeting" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titel", { exact: true }).fill("Weekly Sync");
  await dialog.getByLabel("Datum", { exact: true }).fill("2026-12-03");
  await dialog.getByLabel("Beginn", { exact: true }).fill("14:00");
  // The end follows the start (default 30 min); pick a duration.
  await expect(dialog.getByLabel("Ende", { exact: true })).toHaveValue("14:30");
  await dialog.getByRole("button", { name: "1 Std.", exact: true }).click();
  await expect(dialog.getByLabel("Ende", { exact: true })).toHaveValue("15:00");
  // End before start is rejected right away.
  await dialog.getByLabel("Ende", { exact: true }).fill("13:00");
  await dialog.getByRole("button", { name: "Meeting erstellen" }).click();
  await expect(dialog.getByText("Die Endzeit muss nach der Startzeit liegen.")).toBeVisible();
  await dialog.getByLabel("Ende", { exact: true }).fill("15:00");

  await dialog.getByRole("button", { name: "Alle", exact: true }).click();
  await dialog.getByLabel("Meeting-Link").fill("meet.google.com/abc-defg-hij");
  await expect(dialog.getByText("Google Meet")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-create.png` });
  await dialog.getByRole("button", { name: "Meeting erstellen" }).click();

  await page.waitForURL(/\/meetings\/[0-9a-f-]{36}$/);
  meetingUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Weekly Sync", level: 1 })).toBeVisible();
  // 14:00 Berlin, although this browser runs in Auckland.
  await expect(page.getByText("Donnerstag, 3. Dezember 2026").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("14:00 – 15:00").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Teilnehmende" })).toContainText("Felix Partner");
  const join = page.getByRole("link", { name: /Meeting beitreten/ });
  await expect(join).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
  await expect(join).toHaveAttribute("target", "_blank");
});

test("shared agenda: add, appears for others, reorder persists", async () => {
  const simon = pages.simon;
  const felix = pages.felix;
  await addPoint(simon, "Pilot Festung Hohensalzburg");
  await addPoint(simon, "Pricing-Modell");
  await addPoint(simon, "Hiring");

  await felix.goto(meetingUrl);
  await expect(items(felix)).toHaveCount(3);
  // A point added by Simon shows up for Felix without reloading (Realtime signal).
  await addPoint(simon, "Roadmap Q1");
  await expect(item(felix, "Roadmap Q1")).toBeVisible({ timeout: 15_000 });
  await expect(item(felix, "Roadmap Q1")).toContainText("Hinzugefügt von Simon Gründer");

  // Keyboard drag & drop: "Hiring" two places up.
  await simon.getByRole("button", { name: "„Hiring“ verschieben" }).focus();
  // dnd-kit animates each keyboard step; give it a moment between presses.
  for (const key of ["Space", "ArrowUp", "ArrowUp", "Space"]) {
    await simon.keyboard.press(key);
    await simon.waitForTimeout(250);
  }
  await expect.poll(() => agendaTitles(simon)).toEqual(["Hiring", "Pilot Festung Hohensalzburg", "Pricing-Modell", "Roadmap Q1"]);
  // Menu alternative (phones): "Roadmap Q1" one up.
  await itemMenu(simon, "Roadmap Q1").click();
  await simon.getByRole("menuitem", { name: "Nach oben" }).click();
  await expect.poll(() => agendaTitles(simon)).toEqual(["Hiring", "Pilot Festung Hohensalzburg", "Roadmap Q1", "Pricing-Modell"]);

  await simon.reload();
  await expect.poll(() => agendaTitles(simon)).toEqual(["Hiring", "Pilot Festung Hohensalzburg", "Roadmap Q1", "Pricing-Modell"]);
  await expect.poll(() => agendaTitles(felix), { timeout: 15_000 }).toEqual([
    "Hiring",
    "Pilot Festung Hohensalzburg",
    "Roadmap Q1",
    "Pricing-Modell",
  ]);
});

test("details, responsible person, discussed and documented outcome", async () => {
  const page = pages.simon;
  // Edit title + description (Markdown).
  await itemMenu(page, "Pilot Festung Hohensalzburg").click();
  await page.getByRole("menuitem", { name: "Bearbeiten" }).click();
  // In edit mode the heading becomes an input: address the point by position (2nd).
  await items(page).nth(1).getByRole("textbox").nth(1).fill("Nächste Schritte und **Zeitplan** abstimmen");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(item(page, "Pilot Festung Hohensalzburg").locator("strong")).toHaveText("Zeitplan");

  // Responsible person as a badge.
  await item(page, "Pilot Festung Hohensalzburg").getByRole("button", { name: "Zuständige Person wählen" }).click();
  await page.getByRole("option", { name: /Felix Partner/ }).click();
  await expect(item(page, "Pilot Festung Hohensalzburg").getByRole("button", { name: /Zuständig: Felix Partner/ })).toBeVisible();

  // Outcome with a checklist; saving marks the point as discussed.
  await item(page, "Pricing-Modell").getByRole("button", { name: "Ergebnis festhalten" }).click();
  await item(page, "Pricing-Modell")
    .getByLabel("Ergebnis")
    .fill("Wir starten mit drei SaaS-Paketen.\n\n- [ ] Preise nächste Woche festlegen");
  await item(page, "Pricing-Modell").getByRole("button", { name: "Speichern" }).click();
  await expect(item(page, "Pricing-Modell")).toContainText("Wir starten mit drei SaaS-Paketen.");
  await expect(item(page, "Pricing-Modell").getByRole("checkbox", { name: /wieder als offen/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("1 von 4 besprochen")).toBeVisible();

  // Mark another one by the round toggle.
  await item(page, "Hiring").getByRole("checkbox", { name: /als besprochen markieren/ }).click();
  await expect(page.getByText("2 von 4 besprochen")).toBeVisible();

  // Felix sees everything after a reload.
  await pages.felix.reload();
  await expect(item(pages.felix, "Pricing-Modell")).toContainText("drei SaaS-Paketen");
  await expect(item(pages.felix, "Pilot Festung Hohensalzburg")).toContainText("Felix Partner");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-agenda.png`, fullPage: true });
  if (SHOTS) {
    await page.getByRole("link", { name: "Meetings" }).last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/03b-header.png` });
  }
});

test("concurrent edits do not overwrite each other", async () => {
  const simon = pages.simon;
  const felix = pages.felix;
  await felix.reload();
  for (const p of [simon, felix]) {
    await itemMenu(p, "Roadmap Q1").click();
    await p.getByRole("menuitem", { name: "Bearbeiten" }).click();
  }
  // "Roadmap Q1" is the 3rd point; both have it open.
  await items(felix).nth(2).getByRole("textbox").first().fill("Roadmap Q1 (Felix)");
  await felix.getByRole("button", { name: "Speichern" }).click();
  await expect(item(felix, "Roadmap Q1 (Felix)")).toBeVisible();

  await items(simon).nth(2).getByRole("textbox").first().fill("Roadmap Q1 (Simon)");
  await simon.getByRole("button", { name: "Speichern" }).click();
  await expect(simon.getByText("Jemand anderes hat diesen Punkt gerade geändert.")).toBeVisible();
  await simon.getByRole("button", { name: "Verwerfen und neu laden" }).click();
  await expect(item(simon, "Roadmap Q1 (Felix)")).toBeVisible();
});

test("issues: create from a point (regular task) and link", async () => {
  const page = pages.simon;
  await itemMenu(page, "Pricing-Modell").click();
  await page.getByRole("menuitem", { name: "Issue erstellen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Titel", { exact: true })).toHaveValue("Pricing-Modell");
  await expect(dialog.getByLabel("Beschreibung")).toHaveValue(/Wir starten mit drei SaaS-Paketen/);
  await dialog.getByLabel("Titel", { exact: true }).fill("Implement new pricing page");
  await dialog.getByRole("button", { name: "Issue erstellen" }).click();
  const chip = item(page, "Pricing-Modell").getByRole("link", { name: /Implement new pricing page/ });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/#\d+ –/);
  await expect(chip).toHaveAttribute("href", /\/projects\/[0-9a-f-]{36}\?task=[0-9a-f-]{36}$/);

  // Link the same issue to another point by its number.
  const number = (await chip.textContent())!.match(/#(\d+)/)![1];
  await itemMenu(page, "Hiring").click();
  await page.getByRole("menuitem", { name: "Issue verknüpfen" }).click();
  await page.getByPlaceholder("#42 oder Titel suchen …").fill(`#${number}`);
  await page.getByRole("option", { name: /Implement new pricing page/ }).click();
  await expect(item(page, "Hiring").getByRole("link", { name: /Implement new pricing page/ })).toBeVisible();
  await item(page, "Hiring").getByRole("button", { name: /Verknüpfung mit „Implement new pricing page“ entfernen/ }).click();
  await expect(item(page, "Hiring").getByRole("link", { name: /Implement new pricing page/ })).toHaveCount(0);

  // The issue exists on the board.
  await chip.click();
  await page.waitForURL(/\/projects\//);
  await expect(page.getByRole("dialog")).toContainText("Implement new pricing page");
  await page.goto(meetingUrl);
});

test("decisions: create from a point, link an existing one, open it", async () => {
  const page = pages.simon;
  await itemMenu(page, "Pricing-Modell").click();
  await page.getByRole("menuitem", { name: "Entscheidung erstellen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titel", { exact: true }).fill("Pricing: drei SaaS-Pakete");
  await dialog.getByRole("button", { name: "Entscheidung erstellen" }).click();
  await expect(item(page, "Pricing-Modell").getByRole("link", { name: /Pricing: drei SaaS-Pakete/ })).toBeVisible();

  await itemMenu(page, "Hiring").click();
  await page.getByRole("menuitem", { name: "Entscheidung verknüpfen" }).click();
  await page.getByPlaceholder("Entscheidung suchen …").fill("SaaS");
  await page.getByRole("option", { name: /Pricing: drei SaaS-Pakete/ }).click();
  const link = item(page, "Hiring").getByRole("link", { name: /Pricing: drei SaaS-Pakete/ });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/decisions\?id=/);
  await expect(page.getByRole("dialog")).toContainText("Pricing: drei SaaS-Pakete");
  await page.goto(meetingUrl);
});

test("calendar: .ics download and Google Calendar link", async () => {
  const page = pages.simon;
  await page.getByRole("button", { name: /Zum Kalender/ }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /Kalenderdatei/ }).click()]);
  expect(download.suggestedFilename()).toBe("weekly-sync.ics");
  const ics = readFileSync((await download.path())!, "utf8");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("DTSTART:20261203T130000Z");
  expect(ics).toContain("DTEND:20261203T140000Z");
  expect(ics).toContain("SUMMARY:Weekly Sync");
  expect(ics).toContain("LOCATION:https://meet.google.com/abc-defg-hij");

  await page.context().route("https://calendar.google.com/**", (r) => r.fulfill({ body: "ok" }));
  await page.getByRole("button", { name: /Zum Kalender/ }).click();
  const [popup] = await Promise.all([page.context().waitForEvent("page"), page.getByRole("menuitem", { name: /Google Kalender/ }).click()]);
  const url = new URL(popup.url());
  expect(url.hostname).toBe("calendar.google.com");
  expect(url.searchParams.get("dates")).toBe("20261203T130000Z/20261203T140000Z");
  expect(url.searchParams.get("text")).toBe("Weekly Sync");
  await popup.close();

  // Other workspaces cannot download it.
  const res = await page.request.get(`${meetingUrl}/ics`);
  expect(res.status()).toBe(200);
  const foreign = await page.request.get(`/meetings/00000000-0000-4000-8000-000000000000/ics`);
  expect(foreign.status()).toBe(404);
});

test("overview: upcoming and past, search, edit and delete", async () => {
  const page = pages.simon;
  // A past meeting.
  await page.goto("/meetings");
  await page.getByRole("button", { name: "Neues Meeting" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Titel", { exact: true }).fill("Kick-off");
  await dialog.getByLabel("Datum", { exact: true }).fill("2026-11-02");
  await dialog.getByLabel("Beginn", { exact: true }).fill("09:00");
  await dialog.getByRole("button", { name: "Meeting erstellen" }).click();
  await page.waitForURL(/\/meetings\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Vergangen", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("link", { name: "Meetings", exact: true }).first().click();

  const upcoming = page.getByRole("region", { name: "Anstehend" });
  const past = page.getByRole("region", { name: "Vergangen" });
  await expect(upcoming.getByRole("link")).toContainText(["Weekly Sync"]);
  await expect(past.getByRole("link")).toContainText(["Kick-off"]);
  await expect(upcoming.getByRole("link", { name: /Weekly Sync/ })).toContainText("14:00 – 15:00");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-overview.png` });

  await page.getByLabel("Meetings nach Titel durchsuchen").fill("kick");
  await expect(page.getByRole("link", { name: /Weekly Sync/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Kick-off/ })).toBeVisible();
  await page.getByLabel("Meetings nach Titel durchsuchen").fill("");

  // Edit: move the meeting by an hour.
  await page.getByRole("link", { name: /Weekly Sync/ }).click();
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Bearbeiten" }).click();
  await page.getByRole("dialog").getByLabel("Beginn", { exact: true }).fill("15:00");
  await expect(page.getByRole("dialog").getByLabel("Ende", { exact: true })).toHaveValue("16:00");
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("15:00 – 16:00").filter({ visible: true })).toBeVisible();

  // Delete one agenda point, then the past meeting (with confirmation).
  await itemMenu(page, "Roadmap Q1 (Felix)").click();
  await page.getByRole("menuitem", { name: "Löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await expect(item(page, "Roadmap Q1 (Felix)")).toHaveCount(0);

  await page.goto("/meetings");
  await page.getByRole("link", { name: /Kick-off/ }).click();
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Meeting löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await page.waitForURL(/\/meetings$/);
  await expect(page.getByRole("link", { name: /Kick-off/ })).toHaveCount(0);
});

test("phone layout", async () => {
  const page = pages.felix;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(meetingUrl);
  await expect(page.getByRole("heading", { name: "Weekly Sync", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-phone-detail.png`, fullPage: true });
  await page.goto("/meetings");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-phone-list.png` });
});

test("no runtime errors in the browser", () => {
  expect(consoleErrors).toEqual([]);
});
