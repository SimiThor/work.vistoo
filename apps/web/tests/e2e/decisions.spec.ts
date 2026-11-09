import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * Decisions & experiments end to end: two real users in an isolated workspace
 * (local stack only). simon = admin, felix = member.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  simon: { email: `simon-dec-${run}@e2e.vistoo.test`, name: "Simon Gründer", role: "admin" },
  felix: { email: `felix-dec-${run}@e2e.vistoo.test`, name: "Felix Partner", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const HOSTING = "Welchen Hosting-Anbieter verwenden wir?";
const LANGCHAIN = "LangChain für den KI-Assistenten evaluieren";

async function open(browser: Browser, who: Who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

async function choose(page: Page, trigger: ReturnType<Page["getByRole"]>, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const table = (page: Page) => page.getByRole("table", { name: "Entscheidungen" }).filter({ visible: true });
const row = (page: Page, title: string) => table(page).getByRole("row").filter({ hasText: title });
const panel = (page: Page) => page.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-dec-" + run}) returning id`;
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

test("capture a decision and an experiment in seconds", async () => {
  const page = pages.simon;
  await page.getByRole("link", { name: "Entscheidungen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Entscheidungen", level: 1 })).toBeVisible();

  await page.getByLabel("Neue Entscheidung").fill(HOSTING);
  await page.keyboard.press("Enter");
  await expect(row(page, HOSTING)).toBeVisible();
  await expect(row(page, HOSTING)).toContainText("Offen");

  await page.getByRole("radio", { name: "Experiment" }).click();
  await page.getByLabel("Neues Experiment").fill(LANGCHAIN);
  await page.keyboard.press("Enter");
  await expect(row(page, LANGCHAIN)).toContainText("Geplant");
});

test("concluding requires the decision and reasoning; the day is set", async () => {
  const page = pages.simon;
  await row(page, HOSTING).getByRole("button", { name: HOSTING }).click();
  const p = panel(page);
  await p.getByRole("textbox", { name: "Kontext" }).fill("Wir benötigen eine skalierbare Hosting-Lösung für unser Backend.");
  await p.getByRole("textbox", { name: "Betrachtete Optionen" }).fill("Railway\nHetzner\nAWS");
  await choose(page, p.getByRole("combobox", { name: "Status" }), "Entschieden");
  await p.getByRole("button", { name: "Speichern" }).click();
  await expect(p.getByText("Bitte halte die finale Entscheidung fest.")).toBeVisible();
  await expect(p.getByText("Bitte begründe den Abschluss.")).toBeVisible();

  await p.getByRole("textbox", { name: /^Entscheidung(?!sdatum)/ }).fill("Railway");
  await p.getByRole("textbox", { name: /^Begründung/ }).fill("Einfache Deployments und geringer Wartungsaufwand sind gerade wichtiger.");
  await expect(p.getByLabel("Entscheidungsdatum")).not.toHaveValue("");
  await p.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();
  await expect(p.getByText(/hat auf Entschieden gesetzt/)).toBeVisible();
  // The list behind the (modal) panel is updated too.
  await p.getByRole("button", { name: "Schließen" }).last().click();
  await expect(row(page, HOSTING)).toContainText("Entschieden");
  await expect(row(page, HOSTING)).toContainText("Railway");
  await row(page, HOSTING).getByRole("button", { name: HOSTING }).click();
});

test("traceable edits", async () => {
  const page = pages.simon;
  const p = panel(page);

  // A change to a concluded decision is recorded with the previous wording.
  await p.getByRole("textbox", { name: /^Begründung/ }).fill("Einfache Deployments, geringer Wartungsaufwand.");
  await p.getByRole("button", { name: "Speichern" }).click();
  await expect(p.getByText(/hat Begründung geändert/)).toBeVisible();
  await p.getByText("Vorherige Fassung anzeigen").click();
  await expect(p.getByText("Einfache Deployments und geringer Wartungsaufwand sind gerade wichtiger.")).toBeVisible();
});

test("supersede keeps the old decision and links both ways", async () => {
  const page = pages.simon;
  await page.goto("/decisions");
  await row(page, HOSTING).getByRole("button", { name: HOSTING }).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Ersetzen" }).click();
  await page.getByLabel("Titel der neuen Entscheidung").fill("Wechseln wir auf Hetzner?");
  await page.getByRole("dialog", { name: "Entscheidung ersetzen" }).getByRole("button", { name: "Ersetzen" }).click();

  // The new decision opens and points back.
  await expect(p.getByRole("textbox", { name: "Titel" })).toHaveValue("Wechseln wir auf Hetzner?");
  await expect(p.getByRole("button", { name: /Ersetzt die frühere Entscheidung/ })).toContainText(HOSTING);
  await p.getByRole("button", { name: /Ersetzt die frühere Entscheidung/ }).click();
  await expect(p.getByRole("textbox", { name: "Titel" })).toHaveValue(HOSTING);
  await expect(p.getByRole("button", { name: /Ersetzt durch/ })).toContainText("Wechseln wir auf Hetzner?");
  await expect(p.getByRole("textbox", { name: /^Entscheidung(?!sdatum)/ })).toHaveValue("Railway");
  await p.getByRole("button", { name: "Schließen" }).last().click();
  await expect(row(page, HOSTING)).toContainText("Ersetzt");
});

test("everyone in the workspace finds it: search and filters", async () => {
  const page = pages.felix;
  await page.goto("/decisions");
  await expect(row(page, HOSTING)).toBeVisible();

  const search = page.getByLabel("Entscheidungen durchsuchen").filter({ visible: true });
  await search.fill("railway"); // final decision text
  await expect(table(page).getByRole("row")).toHaveCount(2); // header + 1
  await expect(row(page, HOSTING)).toBeVisible();
  await search.fill("langch");
  await expect(row(page, LANGCHAIN)).toBeVisible();
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await search.fill("");

  await page.getByRole("group", { name: "Typ" }).filter({ visible: true }).getByRole("button", { name: "Experimente" }).click();
  await expect(row(page, LANGCHAIN)).toBeVisible();
  await expect(row(page, HOSTING)).toHaveCount(0);
  await page.getByRole("button", { name: "Zurücksetzen" }).filter({ visible: true }).click();
  await expect(row(page, HOSTING)).toBeVisible();
});

test("delete with confirmation", async () => {
  const page = pages.felix;
  await page.goto("/decisions");
  await row(page, LANGCHAIN).getByRole("button", { name: LANGCHAIN }).click();
  await panel(page).getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await expect(row(page, LANGCHAIN)).toHaveCount(0);
});
