import { expect, test, type Browser, type Page } from "@playwright/test";
import { card, column, latestMail, linkFrom, loginWithCode, MAILPIT, state } from "./support";

test.describe.configure({ mode: "serial" });

let adminPage: Page;
let memberPage: Page;
const TASK = "E2E: Hero-Text schreiben";

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test("first admin accepts the invitation from the e-mail link", async ({ browser }) => {
  const s = state();
  adminPage = await newPage(browser);
  const mail = await latestMail(s.adminEmail, 0);
  expect(mail.subject).toBe("Einladung zu Vistoo");
  await adminPage.goto(linkFrom(mail.html));
  await expect(adminPage.getByRole("heading", { name: /Willkommen bei Vistoo/ })).toBeVisible();
  await adminPage.getByLabel("Dein Name").fill("Anna Admin");
  await adminPage.getByRole("button", { name: "Einladung annehmen" }).click();
  await expect(adminPage).toHaveURL(/\/tasks/);
  await expect(adminPage.getByRole("heading", { name: "Noch keine Projekte" })).toBeVisible();
});

test("an authenticated user without invitation gets no workspace data", async ({ browser }) => {
  const page = await newPage(browser);
  await loginWithCode(page, state().strangerEmail);
  await expect(page).toHaveURL(/\/invite/);
  await expect(page.getByRole("heading", { name: "Kein Zugang" })).toBeVisible();
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/invite/);
  await page.close();
});

test("create project and group", async () => {
  const page = adminPage;
  await page.getByRole("link", { name: "Projekte" }).first().click();
  await page.getByRole("button", { name: "Projekt erstellen", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("E2E Website");
  await page.getByRole("radio", { name: "Grün" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Projekt erstellen" }).click();
  await expect(page.getByRole("heading", { name: "E2E Website" })).toBeVisible();

  await page.getByRole("button", { name: "Projektaktionen" }).click();
  await page.getByRole("menuitem", { name: "Gruppen verwalten" }).click();
  await page.getByRole("dialog").getByLabel("Neue Gruppe").fill("Design");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByRole("dialog").getByText("Design", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("create a task and assign it", async () => {
  const page = adminPage;
  await page.getByRole("button", { name: "Aufgabe erstellen" }).first().click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Titel").fill(TASK);
  await panel.getByLabel("Verantwortlich").click();
  await page.getByRole("option", { name: "Anna Admin" }).click();
  await panel.getByLabel("Gruppe").click();
  await page.getByRole("option", { name: "Design" }).click();
  await panel.getByRole("button", { name: "Erstellen" }).click();
  await expect(panel).toBeHidden();
  await expect(card(page, TASK)).toBeVisible();
  await expect(column(page, "Offen").getByText(TASK)).toBeVisible();
});

test("move the task to another column with the keyboard and persist it", async () => {
  const page = adminPage;
  const c = card(page, TASK);
  await c.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect(column(page, "In Arbeit").getByText(TASK)).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(column(page, "In Arbeit").getByText(TASK)).toBeVisible();
});

test("filters are kept when switching to the timeline and the URL is shareable", async () => {
  const page = adminPage;
  await page.getByRole("button", { name: "Meine Aufgaben" }).click();
  await expect(page).toHaveURL(/assignee=/);
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/view=timeline/);
  await expect(page).toHaveURL(/assignee=/);
  await expect(page.getByRole("button", { name: "Meine Aufgaben" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Nicht vollständig geplant")).toBeVisible();

  // Browser back returns to the board with the filter still active.
  await page.goBack();
  await expect(page).not.toHaveURL(/view=timeline/);
  await expect(page).toHaveURL(/assignee=/);
  await page.goForward();
  await expect(page).toHaveURL(/view=timeline/);
});

test("set dates in the panel; the timeline shows the exact calendar days", async () => {
  const page = adminPage;
  await page.getByRole("button", { name: `Termine für „${TASK}“ setzen` }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Start", { exact: true }).fill("2026-11-09");
  await panel.getByLabel("Ende", { exact: true }).fill("2026-11-08");
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(panel.getByText("Das Enddatum darf nicht vor dem Startdatum liegen.")).toBeVisible();
  await panel.getByLabel("Ende", { exact: true }).fill("2026-11-13");
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(panel.getByText("Gespeichert")).toBeVisible();
  await panel.getByRole("button", { name: "Schließen" }).first().click();
  await expect(panel).toBeHidden();
  // Accessible row label contains the exact dates (Pacific/Auckland timezone in this test).
  await expect(
    page.getByRole("button", { name: /Montag, 9\. November 2026 bis Freitag, 13\. November 2026, 5 Tage/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(/assignee=/); // filter preserved after closing the panel
});

test("invite a member who accepts in a second browser", async ({ browser }) => {
  const s = state();
  const page = adminPage;
  await page.getByRole("link", { name: "Team" }).first().click();
  const since = Date.now();
  await page.getByRole("button", { name: "Mitglied einladen" }).click();
  await page.getByRole("dialog").getByLabel("E-Mail-Adresse").fill(s.memberEmail);
  await page.getByRole("button", { name: "Einladung senden" }).click();
  await expect(page.getByText(s.memberEmail, { exact: true })).toBeVisible();

  memberPage = await newPage(browser);
  const mail = await latestMail(s.memberEmail, since);
  await memberPage.goto(linkFrom(mail.html));
  await memberPage.getByLabel("Dein Name").fill("Max Mitglied");
  await memberPage.getByRole("button", { name: "Einladung annehmen" }).click();
  await expect(memberPage).toHaveURL(/\/tasks/);
  await expect(card(memberPage, TASK)).toBeVisible();
  // Members cannot manage the team
  await memberPage.goto("/team");
  await expect(memberPage.getByText("Nur Admins können Mitglieder einladen")).toBeVisible();
  await expect(memberPage.getByRole("button", { name: "Mitglied einladen" })).toHaveCount(0);
  await memberPage.goto("/tasks");
});

test("changes arrive in the second client without reload", async () => {
  const page = adminPage;
  await page.goto("/tasks");
  await expect(card(memberPage, TASK)).toBeVisible();
  await page.waitForTimeout(1500); // let both realtime channels subscribe
  await card(page, TASK).getByText(TASK).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("Titel").fill(`${TASK} (live)`);
  await panel.getByRole("button", { name: "Speichern" }).click();
  await expect(panel.getByText("Gespeichert")).toBeVisible();
  await expect(card(memberPage, `${TASK} (live)`)).toBeVisible({ timeout: 15_000 });
  await panel.getByRole("button", { name: "Schließen" }).first().click();
});

test("removing a member revokes access immediately, even with an open session", async () => {
  const s = state();
  const page = adminPage;
  await page.goto("/team");
  await page.getByRole("button", { name: "Aktionen für Max Mitglied" }).click();
  await page.getByRole("menuitem", { name: /Aus dem Team entfernen/ }).click();
  await page.getByRole("button", { name: "Entfernen" }).click();
  await expect(page.getByText(s.memberEmail, { exact: true })).toHaveCount(0);

  // The member's open tab: next action is rejected, reload shows no data.
  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/invite/);
  await expect(memberPage.getByRole("heading", { name: "Kein Zugang" })).toBeVisible();
});

test.afterAll(async () => {
  // Leave Mailpit tidy for the next run (best effort).
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
});
