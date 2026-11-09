import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { loginWithCode } from "./support";

/**
 * Markdown task descriptions (local stack only): Schreiben/Vorschau editor, toolbar,
 * GFM rendering, interactive checklists persisted via `setTaskChecklistItem`,
 * no data loss with concurrent edits, XSS safety, mobile layout.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const email = `anna-md-${run}@e2e.vistoo.test`;
let sql: ReturnType<typeof postgres>;
let page: Page;
let wsId = "";
let userId = "";
let projectId = "";

const DESCRIPTION = `## Aufgaben

- [x] Datenbankstruktur erstellen
- [ ] API implementieren
  - [ ] Endpunkte
  - [ ] Tests
- [ ] Frontend entwickeln

| Spalte | Wert |
| --- | --- |
| A | 1 |

\`\`\`ts
const answer: number = 42;
\`\`\`

Mehr in der [Doku](https://example.com/docs) und **fett**, _kursiv_, ~~weg~~, \`inline\`.

> Zitat

---

1. Eins
2. Zwei`;

async function open(browser: Browser, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "de-DE", hasTouch: viewport.width < 600 });
  const p = await ctx.newPage();
  await loginWithCode(p, email);
  await p.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return p;
}

async function insertTask(title: string, description: string): Promise<string> {
  const [t] = await sql`
    insert into tasks (workspace_id, project_id, title, description, position, created_by, updated_by)
    values (${wsId}, ${projectId}, ${title}, ${description}, 1024, ${userId}, ${userId}) returning id`;
  return t.id as string;
}

const dbTask = async (id: string) =>
  (await sql`select title, description, version from tasks where id = ${id}`)[0] as {
    title: string;
    description: string;
    version: number;
  };

const panel = (p: Page) => p.getByRole("dialog");
const description = (p: Page) => panel(p).getByTestId("task-description");
const rendered = (p: Page) => description(p).locator(".markdown-body");
const checkbox = (scope: Locator, text: string) => scope.getByRole("checkbox", { name: `${text} erledigt` });

async function openTask(p: Page, id: string) {
  await p.goto(`/tasks?task=${id}`);
  await expect(panel(p)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-md-" + run}) returning id`;
  wsId = ws.id;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await sql`insert into profiles (id, email, full_name) values (${userId}, ${email}, 'Anna Admin')`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${wsId}, ${userId}, 'admin')`;
  const [p] = await sql`insert into projects (workspace_id, name, created_by) values (${wsId}, 'Markdown', ${userId}) returning id`;
  projectId = p.id;
  page = await open(browser);
});

test.afterAll(async () => {
  await sql?.end();
});

test("write markdown with the toolbar, switch Schreiben/Vorschau without losing content, save", async () => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Aufgabe erstellen" }).first().click();
  const p = panel(page);
  await p.getByLabel("Titel").fill("MD: Neu");
  const editor = p.getByLabel("Beschreibung");
  await expect(p.getByRole("tab", { name: "Schreiben" })).toHaveAttribute("aria-selected", "true");

  // Toolbar + list continuation on Enter.
  await editor.click();
  await p.getByRole("button", { name: /^Checkliste/ }).click();
  await page.keyboard.type("Erster Punkt");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zweiter Punkt");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // empty item ends the list
  await page.keyboard.type("wichtig");
  await page.keyboard.press("Shift+ArrowLeft");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("- [ ] Erster Punkt\n- [ ] Zweiter Punkt\n**wichtig**");
  // Undo restores the previous text (single undoable edit).
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toHaveValue("- [ ] Erster Punkt\n- [ ] Zweiter Punkt\nwichtig");
  await editor.fill("  eingerückt\n\n" + DESCRIPTION);

  await p.getByRole("tab", { name: "Vorschau" }).click();
  const preview = p.getByRole("tabpanel").locator(".markdown-body");
  await expect(preview.getByRole("heading", { name: "Aufgaben", level: 2 })).toBeVisible();
  await expect(preview.getByRole("checkbox")).toHaveCount(5);
  await p.getByRole("tab", { name: "Schreiben" }).click();
  await expect(editor).toHaveValue("  eingerückt\n\n" + DESCRIPTION);

  await p.getByRole("button", { name: "Erstellen" }).click();
  await expect(p).toBeHidden();
  const [row] = await sql`select description from tasks where workspace_id = ${wsId} and title = 'MD: Neu'`;
  expect(row.description).toBe("  eingerückt\n\n" + DESCRIPTION);
});

test("rendered view: headings, lists, tables, code, links", async () => {
  const id = await insertTask("MD: Ansicht", DESCRIPTION);
  await openTask(page, id);
  const md = rendered(page);
  await expect(md.getByRole("heading", { name: "Aufgaben", level: 2 })).toBeVisible();
  await expect(md.locator(":scope > ul.contains-task-list > li")).toHaveCount(3);
  await expect(md.locator("li > ul.contains-task-list > li")).toHaveCount(2);
  await expect(md.locator("ol > li")).toHaveCount(2);
  await expect(md.getByRole("table")).toBeVisible();
  await expect(md.getByRole("cell", { name: "1" })).toBeVisible();
  await expect(md.locator("pre code.hljs.language-ts")).toContainText("const answer");
  await expect(md.locator("pre code .hljs-keyword").first()).toHaveText("const");
  await expect(md.locator("strong")).toHaveText("fett");
  await expect(md.locator("em")).toHaveText("kursiv");
  await expect(md.locator("del")).toHaveText("weg");
  await expect(md.locator("blockquote")).toContainText("Zitat");
  await expect(md.locator("hr")).toHaveCount(1);
  const link = md.getByRole("link", { name: "Doku" });
  await expect(link).toHaveAttribute("href", "https://example.com/docs");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
});

test("checkboxes tick directly in the view, persist after reload, nested ones included; status unchanged", async () => {
  const id = await insertTask("MD: Checkliste", DESCRIPTION);
  await openTask(page, id);
  const md = rendered(page);
  await expect(checkbox(md, "Datenbankstruktur erstellen")).toBeChecked();
  await checkbox(md, "Endpunkte").check(); // nested
  await expect(checkbox(md, "Endpunkte")).toBeChecked();
  await checkbox(md, "Datenbankstruktur erstellen").uncheck();
  await expect.poll(async () => (await dbTask(id)).version).toBe(3);

  const after = await dbTask(id);
  expect(after.description).toBe(
    DESCRIPTION.replace("- [x] Datenbankstruktur", "- [ ] Datenbankstruktur").replace(
      "  - [ ] Endpunkte",
      "  - [x] Endpunkte",
    ),
  );
  const [{ status }] = await sql`select status from tasks where id = ${id}`;
  expect(status).toBe("open");
  // No unsaved state was created.
  await expect(panel(page).getByRole("button", { name: "Speichern" })).toBeDisabled();

  await page.reload();
  await expect(checkbox(rendered(page), "Endpunkte")).toBeChecked();
  await expect(checkbox(rendered(page), "Datenbankstruktur erstellen")).not.toBeChecked();
  await expect(checkbox(rendered(page), "Tests")).not.toBeChecked();
});

test("ticking keeps unsaved edits of other fields and saves without a conflict", async () => {
  const id = await insertTask("MD: Parallel", DESCRIPTION);
  await openTask(page, id);
  await panel(page).getByLabel("Titel").fill("MD: Parallel (umbenannt)");
  await checkbox(rendered(page), "API implementieren").check();
  await expect.poll(async () => (await dbTask(id)).version).toBe(2);
  await expect(panel(page).getByLabel("Titel")).toHaveValue("MD: Parallel (umbenannt)");
  await panel(page).getByRole("button", { name: "Speichern" }).click();
  await expect(panel(page).getByText("Gespeichert")).toBeVisible();
  const t = await dbTask(id);
  expect(t.title).toBe("MD: Parallel (umbenannt)");
  expect(t.description).toContain("- [x] API implementieren");
});

test("concurrent change by someone else is not overwritten by a tick", async () => {
  const id = await insertTask("MD: Fremd", DESCRIPTION);
  await openTask(page, id);
  await expect(checkbox(rendered(page), "Tests")).toBeVisible();
  // Another user adds a line above and changes the title (realtime may or may not have arrived).
  await sql`update tasks set title = 'MD: Fremd geändert',
              description = replace(description, '## Aufgaben', '## Aufgaben' || chr(10) || chr(10) || 'Neuer Absatz von Ben'),
              version = version + 1 where id = ${id}`;
  await checkbox(rendered(page), "Tests").check();
  await expect.poll(async () => (await dbTask(id)).description).toContain("  - [x] Tests");
  const t = await dbTask(id);
  expect(t.title).toBe("MD: Fremd geändert");
  expect(t.description).toContain("Neuer Absatz von Ben");
  expect(t.description.replace("  - [x] Tests", "  - [ ] Tests").replace("\n\nNeuer Absatz von Ben", "")).toBe(
    DESCRIPTION,
  );
});

test("existing plain-text descriptions stay intact; edit → Schreiben tab with the source", async () => {
  const plain = "Erste Zeile\nZweite Zeile\n\n    eingerückt bleibt\nURL: https://vistoo.de";
  const id = await insertTask("MD: Alt", plain);
  await openTask(page, id);
  await expect(rendered(page)).toContainText("Erste Zeile");
  await expect(rendered(page).getByRole("link", { name: "https://vistoo.de" })).toBeVisible();
  await description(page).getByRole("button", { name: "Bearbeiten" }).click();
  const editor = panel(page).getByLabel("Beschreibung");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(plain);
  await panel(page).getByLabel("Titel").fill("MD: Alt (neu)");
  await panel(page).getByRole("button", { name: "Speichern" }).click();
  await expect(panel(page).getByText("Gespeichert")).toBeVisible();
  expect((await dbTask(id)).description).toBe(plain);
  // After saving, the description is shown rendered again.
  await expect(rendered(page)).toBeVisible();
});

test("no XSS: raw HTML and javascript: links are not executed", async () => {
  const evil = [
    "<script>window.__xss = 1</script>",
    '<img src="x" onerror="window.__xss = 2">',
    '<a href="javascript:window.__xss=3">html-link</a>',
    "[md-link](javascript:window.__xss=4)",
    "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "![bild](javascript:window.__xss=5)",
    "<iframe src=\"https://example.com\"></iframe>",
    "- [ ] <b onmouseover=\"window.__xss=6\">hover</b>",
  ].join("\n\n");
  const id = await insertTask("MD: XSS", evil);
  await openTask(page, id);
  const md = rendered(page);
  await expect(md).toContainText("md-link");
  await expect(md.locator("script, iframe, img, [onerror], [onmouseover], b")).toHaveCount(0);
  for (const name of ["md-link", "data"]) {
    const href = await md.getByText(name, { exact: true }).getAttribute("href");
    expect(href ?? "").not.toMatch(/^(javascript|data):/i);
  }
  await md.getByText("md-link", { exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("mobile: rendered description fits, wide tables and code scroll inside", async ({ browser }) => {
  const wide = `${DESCRIPTION}\n\n| ${Array.from({ length: 12 }, (_, i) => `Spalte ${i}`).join(" | ")} |\n|${" --- |".repeat(12)}\n| ${Array.from({ length: 12 }, () => "Inhalt").join(" | ")} |\n\n\`\`\`\n${"x".repeat(300)}\n\`\`\``;
  const id = await insertTask("MD: Mobil", wide);
  const mobile = await open(browser, { width: 390, height: 844 });
  await openTask(mobile, id);
  const md = rendered(mobile);
  await expect(md.getByRole("table").first()).toBeVisible();
  const overflow = await md.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const bodyOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(bodyOverflow).toBeLessThanOrEqual(1);
  await checkbox(md, "Frontend entwickeln").check();
  await expect.poll(async () => (await dbTask(id)).description).toContain("- [x] Frontend entwickeln");
  // Editor on mobile: tabs and toolbar visible, no horizontal overflow.
  await description(mobile).getByRole("button", { name: "Bearbeiten" }).click();
  await expect(panel(mobile).getByRole("toolbar", { name: "Formatierung" })).toBeVisible();
  const editorOverflow = await description(mobile).evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(editorOverflow).toBeLessThanOrEqual(1);
  await mobile.context().close();
});
