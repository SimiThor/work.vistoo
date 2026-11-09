import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * Issue numbers and `#` references in chat (local stack only).
 * anna = admin, ben = member. A second workspace holds a task with a unique
 * title that must never show up for them.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  anna: { email: `anna-i-${run}@e2e.vistoo.test`, name: "Anna Admin", role: "admin" },
  ben: { email: `ben-i-${run}@e2e.vistoo.test`, name: "Ben Bauer", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const ids = {} as Record<Who, string>;
const SECRET = `Geheimprojekt ${run}`;
/** Tasks in creation order → numbers #1…#4 in this fresh workspace. */
const TITLES = ["Implement AR navigation", "Improve onboarding", "Fix dashboard layout", "Logo überarbeiten"];
const taskIds: string[] = [];

async function open(browser: Browser, who: Who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE", hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

const composer = (p: Page) => p.getByRole("textbox", { name: /^Nachricht (in|an) / });
const picker = (p: Page) => p.getByRole("listbox", { name: "Aufgabe verlinken" });
const people = (p: Page) => p.getByRole("listbox", { name: "Personen erwähnen" });
const messageList = (p: Page) => p.getByRole("list", { name: /^Nachrichten in / });

async function openGeneral(p: Page) {
  await p.goto("/chat");
  await p.getByRole("link", { name: /^Allgemein/ }).click();
  await expect(composer(p)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-issues-" + run}) returning id`;
  for (const who of Object.keys(users) as Who[]) {
    const u = users[who];
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error) throw error;
    ids[who] = data.user.id;
    await sql`insert into profiles (id, email, full_name) values (${data.user.id}, ${u.email}, ${u.name})`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${data.user.id}, ${u.role})`;
  }
  const [p] = await sql`insert into projects (workspace_id, name, created_by) values (${ws.id}, 'App', ${ids.anna}) returning id`;
  for (const [i, title] of TITLES.entries()) {
    const [t] = await sql`insert into tasks (workspace_id, project_id, title, position, created_by, updated_by)
                          values (${ws.id}, ${p.id}, ${title}, ${(i + 1) * 1024}, ${ids.anna}, ${ids.anna}) returning id, number`;
    expect(t.number).toBe(i + 1);
    taskIds.push(t.id);
  }
  // Another workspace: same numbers exist there, its task must stay invisible.
  const [other] = await sql`insert into workspaces (name, slug) values ('Andere', ${"e2e-issues-x-" + run}) returning id`;
  const [op] = await sql`insert into projects (workspace_id, name) values (${other.id}, 'Fremd') returning id`;
  await sql`insert into tasks (workspace_id, project_id, title, position, created_by)
            values (${other.id}, ${op.id}, ${SECRET}, 1024, ${ids.anna})`;
  await sql.end();
  pages.anna = await open(browser, "anna");
  pages.ben = await open(browser, "ben");
});

test("issue numbers appear on the board and in the task panel; search finds #number", async () => {
  const { anna } = pages;
  await anna.goto("/tasks");
  const card = anna.locator('[aria-roledescription="verschiebbare Aufgabe"]', { hasText: TITLES[2] }).filter({ visible: true });
  await expect(card).toContainText(TITLES[2]);
  await expect(card.getByText("#3", { exact: true })).toBeVisible();

  await card.click();
  const panel = anna.getByRole("dialog", { name: "Aufgabe #3" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Nummer #3 kopieren" })).toBeVisible();
  await anna.keyboard.press("Escape");

  await anna.getByRole("searchbox").filter({ visible: true }).first().fill("#2");
  await expect(
    anna.locator('[aria-roledescription="verschiebbare Aufgabe"]').filter({ visible: true }),
  ).toHaveCount(1);
});

test("# opens the picker: number and title search, keyboard, mouse, escape, click outside", async () => {
  const { anna } = pages;
  await openGeneral(anna);
  const box = composer(anna);

  await box.pressSequentially("Bitte #");
  await expect(picker(anna)).toBeVisible();
  // Newest first, each with number and title.
  await expect(picker(anna).getByRole("option")).toHaveText([
    /#4\s*Logo überarbeiten/,
    /#3\s*Fix dashboard layout/,
    /#2\s*Improve onboarding/,
    /#1\s*Implement AR navigation/,
  ]);
  await expect(picker(anna)).not.toContainText(SECRET);

  // By number.
  await box.pressSequentially("3");
  await expect(picker(anna).getByRole("option").first()).toHaveText(/#3\s*Fix dashboard layout/);
  // Escape closes, keeps the text.
  await box.press("Escape");
  await expect(picker(anna)).toBeHidden();
  await expect(box).toHaveValue("Bitte #3");
  await box.press("Backspace");
  await box.press("Backspace");

  // By title, arrows + Enter.
  await box.pressSequentially("#onb");
  await expect(picker(anna).getByRole("option")).toHaveText([/#2\s*Improve onboarding/]);
  await box.press("Enter");
  await expect(box).toHaveValue("Bitte #2 ");

  // Tab selects.
  await box.pressSequentially("und #dash");
  await expect(picker(anna).getByRole("option")).toHaveText([/#3\s*Fix dashboard layout/]);
  await box.press("Tab");
  await expect(box).toHaveValue("Bitte #2 und #3 ");

  // Foreign workspace stays invisible, also by title.
  await box.pressSequentially("#Geheim");
  await expect(picker(anna)).toBeHidden();
  for (let i = 0; i < "#Geheim".length; i++) await box.press("Backspace");

  // Click outside closes, a click on an option selects.
  await box.pressSequentially("#");
  await expect(picker(anna)).toBeVisible();
  await anna.getByRole("heading", { name: "Allgemein" }).click();
  await expect(picker(anna)).toBeHidden();
  await box.click();
  await box.press("End");
  await box.press("Backspace");
  await box.pressSequentially("#ar ");
  await picker(anna).getByRole("option", { name: /Implement AR navigation/ }).click();
  await expect(box).toHaveValue("Bitte #2 und #3 #1 ");
  await expect(box).toBeFocused();

  // A reference is atomic: Backspace into it removes it completely.
  await box.press("Backspace");
  await box.press("Backspace");
  await expect(box).toHaveValue("Bitte #2 und #3 ");

  // @mentions keep working next to # references.
  await box.pressSequentially("@be");
  await expect(people(anna).getByRole("option")).toHaveText([/Ben Bauer/]);
  await box.press("Enter");
  await box.pressSequentially("anschauen?");
  await box.press("Enter");

  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" });
  await expect(msg.locator("[data-issue-ref]")).toHaveText(["#2", "#3"]);
  await expect(msg.locator("[data-mention]")).toHaveText(["@Ben Bauer"]);
});

test("references survive reload, show details on hover and open the right task", async () => {
  const { anna } = pages;
  await anna.reload();
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" });
  const ref = msg.getByRole("link", { name: "#3 Fix dashboard layout öffnen" });
  await expect(ref).toBeVisible();
  await ref.hover();
  await expect(anna.getByRole("tooltip")).toContainText("Fix dashboard layout");
  await ref.click();
  await anna.waitForURL(new RegExp(`/tasks\\?task=${taskIds[2]}`));
  await expect(anna.getByRole("dialog", { name: "Aufgabe #3" })).toBeVisible();
});

test("other members see the references live and can open them", async () => {
  const { ben } = pages;
  await openGeneral(ben);
  const msg = messageList(ben).getByRole("listitem").filter({ hasText: "anschauen?" });
  await expect(msg.locator("[data-issue-ref]")).toHaveText(["#2", "#3"]);
  await msg.getByRole("link", { name: /^#2 Improve onboarding/ }).click();
  await ben.waitForURL(new RegExp(`/tasks\\?task=${taskIds[1]}`));
  await expect(ben.getByRole("dialog", { name: "Aufgabe #2" })).toBeVisible();
});

test("clicking a mentioned person opens the direct conversation with them", async () => {
  const { anna, ben } = pages;
  await openGeneral(anna);
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" });
  await msg.getByRole("button", { name: "@Ben Bauer, Direktnachricht öffnen" }).click();
  await anna.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(composer(anna)).toHaveAccessibleName(/^Nachricht an Ben Bauer/);
  const dmUrl = anna.url();
  // Same conversation again, no duplicate; the own mention stays plain text for Ben.
  await openGeneral(anna);
  await messageList(anna)
    .getByRole("listitem")
    .filter({ hasText: "anschauen?" })
    .getByRole("button", { name: "@Ben Bauer, Direktnachricht öffnen" })
    .click();
  await anna.waitForURL(dmUrl);
  await openGeneral(ben);
  const own = messageList(ben).getByRole("listitem").filter({ hasText: "anschauen?" }).locator("[data-mention]");
  await expect(own).toHaveText(["@Ben Bauer"]);
  await expect(own).not.toHaveRole("button");
});

test("renamed tasks show their new title; editing keeps and adds references", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`update tasks set title = 'Dashboard-Layout reparieren' where id = ${taskIds[2]}`;
  await sql.end();
  const { anna } = pages;
  await openGeneral(anna);
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" });
  await expect(msg.getByRole("link", { name: "#3 Dashboard-Layout reparieren öffnen" })).toBeVisible();

  await msg.hover();
  await msg.getByRole("button", { name: "Aktionen für deine Nachricht" }).click();
  await anna.getByRole("menuitem", { name: "Bearbeiten" }).click();
  const edit = anna.getByRole("textbox", { name: "Nachricht bearbeiten" });
  await expect(edit).toHaveValue("Bitte #2 und #3 @Ben Bauer anschauen?");
  await edit.press("End");
  await edit.pressSequentially(" + #logo");
  await expect(picker(anna).getByRole("option")).toHaveText([/#4\s*Logo überarbeiten/]);
  await edit.press("Enter"); // picks #4
  await edit.press("Enter"); // saves
  await expect(edit).toBeHidden();
  await expect(msg.locator("[data-issue-ref]")).toHaveText(["#2", "#3", "#4"]);
  await anna.reload();
  await expect(
    messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" }).locator("[data-issue-ref]"),
  ).toHaveText(["#2", "#3", "#4"]);
});

test("deleted tasks render as deleted, without a link", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`delete from tasks where id = ${taskIds[3]}`;
  await sql.end();
  const { anna } = pages;
  await openGeneral(anna);
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "anschauen?" });
  await expect(msg.locator("[data-issue-ref]")).toHaveText(["#2", "#3", "#gelöschte Aufgabe"]);
  await expect(msg.getByRole("link", { name: /gelöschte/ })).toHaveCount(0);
});

test("mobile: references are tappable", async ({ browser }) => {
  const phone = await open(browser, "ben", { width: 390, height: 844 });
  await openGeneral(phone);
  const msg = messageList(phone).getByRole("listitem").filter({ hasText: "anschauen?" });
  await msg.getByRole("link", { name: /^#2 / }).tap();
  await phone.waitForURL(new RegExp(`/tasks\\?task=${taskIds[1]}`));
  await expect(phone.getByRole("dialog", { name: "Aufgabe #2" })).toBeVisible();
  await phone.context().close();
});
