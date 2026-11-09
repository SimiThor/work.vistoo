import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { card, loginWithCode } from "./support";

/**
 * Personal to-dos, ideas, milestones and CRM end to end: two real users in an isolated
 * workspace (local stack only). simon = admin, felix = member.
 */
test.describe.configure({ mode: "serial" });

config({ path: ".env.local", quiet: true });
const run = Date.now().toString(36);
const users = {
  simon: { email: `simon-${run}@e2e.vistoo.test`, name: "Simon Gründer", role: "admin" },
  felix: { email: `felix-${run}@e2e.vistoo.test`, name: "Felix Partner", role: "member" },
} as const;
type Who = keyof typeof users;
const pages = {} as Record<Who, Page>;
const PROJECT = `Website ${run}`;

async function open(browser: Browser, who: Who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const page = await ctx.newPage();
  await loginWithCode(page, users[who].email);
  await page.waitForURL(/\/tasks/, { waitUntil: "commit" });
  return page;
}

/** Resolves when the Server Action whose arguments contain `marker` has answered. */
const actionDone = (page: Page, marker: string) =>
  page.waitForResponse(
    (r) => r.request().method() === "POST" && r.status() === 200 && (r.request().postData() ?? "").includes(marker),
  );

/** Radix select: open the trigger, pick the option. */
async function choose(page: Page, trigger: ReturnType<Page["getByRole"]>, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.beforeAll(async ({ browser }) => {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local stack only");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [ws] = await sql`insert into workspaces (name, slug) values ('Vistoo', ${"e2e-ws-" + run}) returning id`;
  await sql`insert into projects (workspace_id, name, color) values (${ws.id}, ${PROJECT}, 'blue')`;
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

test("my to-dos: add, complete, reopen, edit — and nobody else sees them", async () => {
  const page = pages.simon;
  await page.getByRole("link", { name: "Meine To-dos" }).click();
  await expect(page.getByRole("heading", { name: "Meine To-dos", level: 1 })).toBeVisible();

  const input = page.getByLabel("Neues To-do");
  // With a note: ⌘/Ctrl+Enter in the note field adds the to-do.
  await input.fill("Domain verlängern");
  await page.getByLabel("Notiz zum neuen To-do").fill("Bei INWX, läuft Ende des Monats ab");
  await page.getByLabel("Notiz zum neuen To-do").press("ControlOrMeta+Enter");
  await expect(page.getByLabel("Notiz zum neuen To-do")).toHaveCount(0);
  await input.fill("Fördermöglichkeiten recherchieren");
  await page.getByRole("button", { name: "Fälligkeitsdatum hinzufügen" }).click();
  await page.getByLabel("Fällig am").fill("2026-11-20");
  await input.press("Enter");

  const open = page.getByRole("list", { name: "Offene To-dos" });
  await expect(open.getByRole("listitem")).toHaveCount(2);
  // Newest on top.
  await expect(open.getByRole("listitem").first()).toContainText("Fördermöglichkeiten recherchieren");
  await expect(open.getByRole("listitem").first()).toContainText("20. Nov.");
  await expect(open.getByRole("listitem").last()).toContainText("Bei INWX, läuft Ende des Monats ab");

  const saved = actionDone(page, '"completed":true');
  await page.getByRole("checkbox", { name: "„Domain verlängern“ erledigt" }).click();
  await saved;
  await expect(open.getByRole("listitem")).toHaveCount(1);
  const doneToggle = page.getByRole("button", { name: "Erledigt · 1" });
  await expect(doneToggle).toHaveAttribute("aria-expanded", "false");

  // Persisted.
  await page.reload();
  await page.getByRole("button", { name: "Erledigt · 1" }).click();
  await page.getByRole("checkbox", { name: "„Domain verlängern“ wieder öffnen" }).click();
  await expect(page.getByRole("list", { name: "Offene To-dos" }).getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: "Fördermöglichkeiten recherchieren", exact: true }).click();
  await page.getByLabel("Titel").fill("Förderungen recherchieren");
  await page.getByLabel("Titel").press("Enter");
  await expect(page.getByText("Förderungen recherchieren")).toBeVisible();

  // Private: Felix's list is empty.
  await pages.felix.goto("/todos");
  await expect(pages.felix.getByText("Noch keine To-dos").filter({ visible: true })).toBeVisible();
  await expect(pages.felix.getByText("Domain verlängern")).toHaveCount(0);
});

test("ideas: shared backlog with status, panel and 'create issue'", async () => {
  const page = pages.simon;
  await page.getByRole("link", { name: "Ideen" }).click();
  // With a text body: ⌘/Ctrl+Enter in the text field adds the idea.
  await page.getByLabel("Neue Idee").fill("Offline-Navigation verbessern");
  await page.getByLabel("Text der neuen Idee").fill("Karten vorab laden\nRouten ohne Netz");
  await page.getByLabel("Text der neuen Idee").press("ControlOrMeta+Enter");
  await expect(page.getByLabel("Text der neuen Idee")).toHaveCount(0);
  await page.getByLabel("Neue Idee").fill("KI-Assistent erweitern");
  await page.getByLabel("Neue Idee").press("Enter");
  await expect(page.getByRole("list", { name: "Ideen" }).getByRole("listitem")).toHaveCount(2);

  // Felix sees them and changes a status directly in the list.
  const felix = pages.felix;
  await felix.goto("/ideas");
  const statusSaved = actionDone(felix, '"status":"planned"');
  await choose(felix, felix.getByRole("combobox", { name: "Status von „KI-Assistent erweitern“" }), "Geplant");
  await statusSaved;
  await felix.reload();
  await expect(felix.getByRole("combobox", { name: "Status von „KI-Assistent erweitern“" })).toContainText("Geplant");

  // Filter + search.
  await felix.getByRole("button", { name: "Geplant" }).click();
  await expect(felix.getByRole("list", { name: "Ideen" }).getByRole("listitem")).toHaveCount(1);
  await felix.getByRole("button", { name: "Alle" }).click();
  await felix.getByLabel("Ideen durchsuchen").filter({ visible: true }).fill("offline");
  await expect(felix.getByRole("list", { name: "Ideen" }).getByRole("listitem")).toHaveCount(1);
  await expect(felix.getByRole("button", { name: /Karten vorab laden/ })).toBeVisible();

  // Panel: description + owner, then create an issue.
  await page.reload();
  await page.getByRole("button", { name: /KI-Assistent erweitern/ }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Text", { exact: true }).fill("Mehr Sprachen und Offline-Antworten");
  await choose(page, panel.getByLabel("Verantwortlich"), "Felix Partner");
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Idee gespeichert")).toBeVisible();

  await panel.getByRole("button", { name: "Issue erstellen" }).click();
  await panel.getByRole("button", { name: "Erstellen", exact: true }).click();
  await expect(page.getByText("Issue erstellt")).toBeVisible();
  const issueLink = panel.getByRole("link", { name: /KI-Assistent erweitern/ });
  await expect(issueLink).toBeVisible();
  await issueLink.click();
  // The regular task panel opens in the project with title and description taken over.
  await expect(page).toHaveURL(/\/projects\/.+\?task=/);
  const taskPanel = page.getByRole("dialog");
  await expect(taskPanel.getByLabel("Titel")).toHaveValue("KI-Assistent erweitern");
  // A non-empty description is shown rendered (Markdown); the editor opens via "Bearbeiten".
  await expect(taskPanel.getByTestId("task-description").locator(".markdown-body")).toHaveText(
    "Mehr Sprachen und Offline-Antworten",
  );
  await taskPanel.getByRole("button", { name: "Schließen" }).first().click();
});

test("milestones: create, add issues from several places, filter and delete without losing tasks", async () => {
  const page = pages.simon;
  const MS = `Launch ${run}`;
  await page.goto("/tasks");
  // The task filter bar offers no group or status filter any more.
  const filters = page.getByRole("search", { name: "Aufgaben filtern" }).filter({ visible: true });
  await expect(filters.getByRole("button", { name: "Meilenstein" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Gruppe" })).toHaveCount(0);
  await expect(filters.getByRole("button", { name: "Status" })).toHaveCount(0);

  // Create from the sidebar → lands on the milestone page.
  await page.getByRole("button", { name: "Meilenstein erstellen" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(MS);
  await dialog.getByLabel(/Zieldatum/).fill("2026-12-15");
  await dialog.getByRole("button", { name: "Meilenstein erstellen" }).click();
  await expect(page.getByRole("heading", { name: MS })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).first().getByRole("link", { name: new RegExp(MS) })).toBeVisible();

  // A task created on the milestone page belongs to it.
  await page.getByRole("button", { name: "Aufgabe erstellen" }).first().click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Titel").fill("Landingpage fertigstellen");
  await expect(panel.getByLabel("Meilenstein")).toContainText(MS);
  await panel.getByRole("button", { name: "Erstellen" }).click();
  await expect(panel).toBeHidden();
  await expect(card(page, "Landingpage fertigstellen")).toBeVisible();

  // Attach an existing issue (from the ideas test) in its task panel.
  await page.goto("/tasks");
  await card(page, "KI-Assistent erweitern").click();
  await choose(page, page.getByRole("dialog").getByLabel("Meilenstein"), MS);
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog").getByText("Gespeichert")).toBeVisible();
  await page.keyboard.press("Escape");

  // Filter in "Alle Aufgaben": only tasks of the milestone, then those without one.
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Aufgabe erstellen" }).first().click();
  await page.getByRole("dialog").getByLabel("Titel").fill("Ohne Meilenstein");
  await page.getByRole("dialog").getByRole("button", { name: "Erstellen" }).click();
  await expect(card(page, "Ohne Meilenstein")).toBeVisible();
  await filters.getByRole("button", { name: "Meilenstein" }).click();
  await page.getByRole("option", { name: MS }).click();
  await page.keyboard.press("Escape");
  await expect(card(page, "Landingpage fertigstellen")).toBeVisible();
  await expect(card(page, "KI-Assistent erweitern")).toBeVisible();
  await expect(card(page, "Ohne Meilenstein")).toHaveCount(0);
  await expect(page).toHaveURL(/milestone=/);

  // Felix sees the milestone with both issues and its progress in the overview.
  const felix = pages.felix;
  await felix.goto("/milestones");
  const row = felix.getByRole("list", { name: "Offene Meilensteine" }).getByRole("listitem").filter({ hasText: MS });
  await expect(row).toContainText("0 von 2 erledigt");
  await row.getByRole("link", { name: MS }).click();
  await expect(card(felix, "Landingpage fertigstellen")).toBeVisible();
  await expect(card(felix, "KI-Assistent erweitern")).toBeVisible();

  // Deleting the milestone keeps the tasks.
  await page.goto("/milestones");
  await page.getByRole("list", { name: "Offene Meilensteine" }).getByRole("link", { name: MS }).click();
  await page.getByRole("button", { name: "Meilensteinaktionen" }).click();
  await page.getByRole("menuitem", { name: "Löschen …" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("2 zugeordneten Aufgaben bleiben");
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await page.waitForURL(/\/milestones$/);
  await page.goto("/tasks");
  await expect(card(page, "Landingpage fertigstellen")).toBeVisible();
  await expect(card(page, "KI-Assistent erweitern")).toBeVisible();
});

test("CRM: add attraction, timeline logs each change exactly once, manual activity sets follow-up", async () => {
  const page = pages.simon;
  await page.getByRole("link", { name: "CRM" }).click();
  await expect(page.getByRole("heading", { name: "Attraktionen", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Attraktion hinzufügen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Festung Hohensalzburg");
  await dialog.getByLabel("Stadt").fill("Salzburg");
  await dialog.getByLabel("Land").fill("Österreich");
  await dialog.getByLabel("Name").press("Enter");
  await expect(page.getByText("Attraktion hinzugefügt")).toBeVisible();

  // The panel opens right away with the creation entry.
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Simon Gründer hat die Attraktion angelegt.")).toBeVisible();

  await choose(page, panel.getByLabel("Status"), "Kontaktiert");
  await panel.getByLabel("E-Mail").fill("info@festung.at");
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(panel.getByText("Simon Gründer hat den Status von Neu auf Kontaktiert geändert.")).toHaveCount(1);
  // Text edits create no timeline entries.
  await expect(panel.getByRole("listitem")).toHaveCount(2);

  // Manual activity with follow-up.
  await panel.getByRole("button", { name: "Aktivität hinzufügen" }).click();
  await panel.getByRole("button", { name: "Anruf" }).click();
  await panel.getByLabel("Beschreibung").fill("Mit Frau Huber über ein Pilotprojekt gesprochen");
  await panel.getByLabel("Nächstes Follow-up (optional)").fill("2026-11-18");
  await panel.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(panel.getByText("Mit Frau Huber über ein Pilotprojekt gesprochen")).toBeVisible();
  await expect(panel.getByText("hat das nächste Follow-up auf Mittwoch, 18. November 2026 gesetzt.")).toBeVisible();
  await expect(panel.getByLabel("Nächstes Follow-up")).toHaveValue("2026-11-18");
  await panel.getByRole("button", { name: "Schließen" }).first().click();

  // Inline status change in the table is logged too.
  const row = page.getByRole("row", { name: /Festung Hohensalzburg/ });
  await expect(row).toContainText("18. Nov.");
  await choose(page, row.getByRole("combobox", { name: "Status von Festung Hohensalzburg" }), "Interessiert");
  await expect(page.getByRole("definition").nth(2)).toHaveText("1"); // "Interessiert" key figure

  // Felix sees the same data and the full history.
  const felix = pages.felix;
  await felix.goto("/crm");
  await felix.getByRole("button", { name: "Festung Hohensalzburg" }).click();
  const fp = felix.getByRole("dialog");
  await expect(fp.getByText("Simon Gründer hat den Status von Kontaktiert auf Interessiert geändert.")).toHaveCount(1);
  await expect(fp.getByText("Anruf")).toBeVisible();
  await fp.getByRole("button", { name: "Schließen" }).first().click();
});

test("CRM: search, filters, overdue follow-ups and delete with confirmation", async () => {
  const page = pages.simon;
  await page.getByRole("button", { name: "Attraktion hinzufügen" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Eisriesenwelt");
  await page.getByRole("dialog").getByRole("button", { name: "Weitere Angaben" }).click();
  await page.getByRole("dialog").getByLabel("Follow-up").fill("2020-01-15");
  await page.getByRole("dialog").getByRole("button", { name: "Hinzufügen" }).click();
  const detail = page.getByRole("dialog", { name: "Attraktion", exact: true });
  await expect(detail.getByText("hat die Attraktion angelegt.")).toBeVisible();
  await detail.getByRole("button", { name: "Schließen" }).first().click();
  await expect(detail).toBeHidden();

  await page.getByLabel("Nach Name oder Standort suchen").fill("salzburg");
  await expect(page.getByRole("row")).toHaveCount(2); // header + Festung (matched by city)
  await page.getByLabel("Nach Name oder Standort suchen").fill("");

  await page.getByRole("button", { name: /Überfällig/ }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Eisriesenwelt/ })).toContainText("15. Jan. 2020");
  await page.getByRole("button", { name: /Überfällig/ }).click();

  await page.getByRole("button", { name: /^Status:/ }).click();
  await page.getByRole("menuitemradio", { name: "Interessiert" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: /^Status:/ }).click();
  await page.getByRole("menuitemradio", { name: "Alle Status" }).click();

  await page.getByRole("button", { name: "Eisriesenwelt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByText("Attraktion gelöscht")).toBeVisible();
  await expect(page.getByRole("row", { name: /Eisriesenwelt/ })).toHaveCount(0);
});
