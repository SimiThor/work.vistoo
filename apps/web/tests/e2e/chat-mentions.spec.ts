import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * @mentions end-to-end (local stack only): anna = admin, ben + carla = members.
 * Carla is not in the private channel "kern".
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  anna: { email: `anna-m-${run}@e2e.vistoo.test`, name: "Anna Admin", role: "admin" },
  ben: { email: `ben-m-${run}@e2e.vistoo.test`, name: "Ben Bauer", role: "member" },
  carla: { email: `carla-m-${run}@e2e.vistoo.test`, name: "Carla Cramer", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const ids = {} as Record<Who, string>;
let wsId = "";
let privateId = "";

async function open(browser: Browser, who: Who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE", hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

const composer = (p: Page) => p.getByRole("textbox", { name: /^Nachricht (in|an) / });
const suggestions = (p: Page) => p.getByRole("listbox", { name: "Personen erwähnen" });
const messageList = (p: Page) => p.getByRole("list", { name: /^Nachrichten in / });
const bell = (p: Page) => p.getByRole("button", { name: /^Mitteilungen/ }).filter({ visible: true });

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
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-mentions-" + run}) returning id`;
  wsId = ws.id;
  for (const who of Object.keys(users) as Who[]) {
    const u = users[who];
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error) throw error;
    ids[who] = data.user.id;
    await sql`insert into profiles (id, email, full_name) values (${data.user.id}, ${u.email}, ${u.name})`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${data.user.id}, ${u.role})`;
  }
  const [priv] = await sql`insert into conversations (workspace_id, kind, name, created_by, owner_id)
                           values (${wsId}, 'private_channel', 'kern', ${ids.anna}, ${ids.anna}) returning id`;
  privateId = priv.id;
  for (const who of ["anna", "ben"] as const) {
    await sql`insert into conversation_members (conversation_id, workspace_id, user_id) values (${privateId}, ${wsId}, ${ids[who]})`;
  }
  await sql.end();
  pages.anna = await open(browser, "anna");
  pages.ben = await open(browser, "ben");
});

test("@ opens suggestions, filters by first/last name, keyboard and mouse select", async () => {
  const { anna } = pages;
  await openGeneral(anna);
  const box = composer(anna);

  await box.pressSequentially("Hey @");
  await expect(suggestions(anna)).toBeVisible();
  await expect(suggestions(anna).getByRole("option")).toHaveText([/Ben Bauer/, /Carla Cramer/]);

  // Last name search.
  await box.pressSequentially("cra");
  await expect(suggestions(anna).getByRole("option")).toHaveText([/Carla Cramer/]);
  await box.press("Escape");
  await expect(suggestions(anna)).toBeHidden();
  await box.press("Backspace");
  await box.press("Backspace");
  await box.press("Backspace");

  // Arrow keys + Enter.
  await expect(suggestions(anna)).toBeHidden(); // still dismissed for this "@"
  await box.press("Backspace");
  await box.pressSequentially("@");
  await expect(suggestions(anna)).toBeVisible();
  await box.press("ArrowDown");
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(box).toHaveValue("Hey @Ben Bauer ");

  // Tab selects, typing continues normally.
  await box.pressSequentially("und @ca");
  await box.press("Tab");
  await box.pressSequentially("schaut mal!");
  await expect(box).toHaveValue("Hey @Ben Bauer und @Carla Cramer schaut mal!");

  // Mouse: click outside closes, click on an option selects.
  await box.pressSequentially(" @");
  await expect(suggestions(anna)).toBeVisible();
  await anna.getByRole("heading", { name: "Allgemein" }).click();
  await expect(suggestions(anna)).toBeHidden();
  await box.click();
  await box.press("End");
  await box.press("Backspace");
  await box.pressSequentially("@b");
  await suggestions(anna).getByRole("option", { name: /Ben Bauer/ }).click();
  await expect(box).toHaveValue("Hey @Ben Bauer und @Carla Cramer schaut mal! @Ben Bauer ");
  await expect(box).toBeFocused();

  // A mention is atomic: one Backspace into it removes it completely.
  await box.press("Backspace"); // the space
  await box.press("Backspace"); // into the mention → gone
  await expect(box).toHaveValue("Hey @Ben Bauer und @Carla Cramer schaut mal! ");

  await box.press("Enter");
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "schaut mal!" });
  await expect(msg.locator("[data-mention]")).toHaveText(["@Ben Bauer", "@Carla Cramer"]);

  // Survives reload.
  await anna.reload();
  await expect(
    messageList(anna).getByRole("listitem").filter({ hasText: "schaut mal!" }).locator("[data-mention]"),
  ).toHaveText(["@Ben Bauer", "@Carla Cramer"]);
});

test("mentioned person gets one in-app notification that opens the message", async () => {
  const { ben } = pages;
  await ben.goto("/chat"); // somewhere else in the app (the bell lives in the shell)
  await expect(bell(ben)).toHaveAccessibleName("Mitteilungen, 1 ungelesen");
  await bell(ben).click();
  const item = ben.getByRole("link", { name: /Anna Admin hat dich in #Allgemein erwähnt/ });
  await expect(item).toContainText("@Ben Bauer und @Carla Cramer schaut mal!");
  await item.click();
  await ben.waitForURL(/\/chat\/[0-9a-f-]+\?message=/);
  const msg = messageList(ben).getByRole("listitem").filter({ hasText: "schaut mal!" });
  await expect(msg).toBeInViewport();
  await expect(bell(ben)).toHaveAccessibleName("Mitteilungen");
});

test("renamed people are shown with their new name", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`update profiles set full_name = 'Benjamin Bauer' where id = ${ids.ben}`;
  await sql.end();
  const { anna } = pages;
  await openGeneral(anna);
  await expect(
    messageList(anna).getByRole("listitem").filter({ hasText: "schaut mal!" }).locator("[data-mention]").first(),
  ).toHaveText("@Benjamin Bauer");
  await openGeneral(anna);
});

test("editing keeps, removes and adds mentions", async () => {
  const { anna } = pages;
  await openGeneral(anna);
  const msg = messageList(anna).getByRole("listitem").filter({ hasText: "schaut mal!" });
  await msg.hover();
  await msg.getByRole("button", { name: "Aktionen für deine Nachricht" }).click();
  await anna.getByRole("menuitem", { name: "Bearbeiten" }).click();
  const edit = anna.getByRole("textbox", { name: "Nachricht bearbeiten" });
  await expect(edit).toHaveValue("Hey @Benjamin Bauer und @Carla Cramer schaut mal!");
  // Replace Carla's mention with plain text, keep Ben's.
  await edit.fill("Hey @Benjamin Bauer schaut mal!");
  await edit.press("End");
  await edit.pressSequentially(" Danke @ann");
  await expect(suggestions(anna)).toBeHidden(); // no self-mention suggestion
  await edit.press("Escape"); // nothing open → cancels editing
  await expect(edit).toBeHidden();

  await msg.hover();
  await msg.getByRole("button", { name: "Aktionen für deine Nachricht" }).click();
  await anna.getByRole("menuitem", { name: "Bearbeiten" }).click();
  await edit.press("End");
  await edit.pressSequentially(" + @car");
  await edit.press("Enter"); // picks Carla again
  await edit.press("Enter"); // saves
  await expect(edit).toBeHidden();
  await expect(msg.locator("[data-mention]")).toHaveText(["@Benjamin Bauer", "@Carla Cramer", "@Carla Cramer"]);
  await anna.reload();
  await expect(
    messageList(anna).getByRole("listitem").filter({ hasText: "schaut mal!" }).locator("[data-mention]"),
  ).toHaveText(["@Benjamin Bauer", "@Carla Cramer", "@Carla Cramer"]);
});

test("private channel offers only its members", async () => {
  const { anna } = pages;
  await anna.goto(`/chat/${privateId}`);
  await composer(anna).pressSequentially("@");
  await expect(suggestions(anna).getByRole("option")).toHaveText([/Benjamin Bauer/]);
  await composer(anna).pressSequentially("car");
  await expect(suggestions(anna)).toBeHidden();
  await composer(anna).fill("");
});

test("manipulated mention of a non-member is rejected by the server", async () => {
  const { anna } = pages;
  await anna.goto(`/chat/${privateId}`);
  // Forge a draft with Carla's token (bypassing the suggestion list) and send it.
  await anna.evaluate(
    ([key, body]) => window.sessionStorage.setItem(key, body),
    [`vistoo:draft:${ids.anna}:${privateId}`, `psst <@${ids.carla}>`],
  );
  await anna.reload();
  await expect(composer(anna)).toHaveValue("psst @Carla Cramer");
  await composer(anna).press("Enter");
  await expect(anna.getByText("Mindestens eine erwähnte Person hat keinen Zugriff auf diese Unterhaltung.")).toBeVisible();
});

test("mobile: suggestions stay inside the viewport and can be tapped", async ({ browser }) => {
  const phone = await open(browser, "carla", { width: 390, height: 844 });
  await openGeneral(phone);
  await composer(phone).tap();
  await composer(phone).pressSequentially("@b");
  const list = suggestions(phone);
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await list.getByRole("option", { name: /Benjamin Bauer/ }).tap();
  await expect(composer(phone)).toHaveValue("@Benjamin Bauer ");
  await expect(bell(phone)).toBeVisible();
  await phone.context().close();
});
