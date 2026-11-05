import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
export const STATE_FILE = path.join(__dirname, ".state.json");

export type E2EState = { runId: string; adminEmail: string; memberEmail: string; strangerEmail: string };
export const state = (): E2EState => JSON.parse(readFileSync(STATE_FILE, "utf8"));

type MailSummary = { ID: string; Created: string; Subject: string };

/** Waits for the newest e-mail to `to` created after `since`. */
export async function latestMail(to: string, since: number): Promise<{ html: string; text: string; subject: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const data = (await res.json()) as { messages: MailSummary[] };
    const fresh = data.messages.find((m) => Date.parse(m.Created) >= since - 1000);
    if (fresh) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as {
        HTML: string;
        Text: string;
        Subject: string;
      };
      return { html: msg.HTML, text: msg.Text, subject: msg.Subject };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No e-mail for ${to}`);
}

export function linkFrom(html: string): string {
  const m = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(html);
  if (!m) throw new Error("No confirm link in e-mail");
  return m[1].replace(/&amp;/g, "&");
}

export function codeFrom(text: string): string {
  const m = /\b(\d{6})\b/.exec(text);
  if (!m) throw new Error("No code in e-mail");
  return m[1];
}

/** Login via the e-mail code flow. */
export async function loginWithCode(page: Page, email: string) {
  const since = Date.now();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmeldelink senden" }).click();
  await expect(page.getByText("Prüfe dein Postfach")).toBeVisible();
  const mail = await latestMail(email, since);
  await page.getByLabel("Code aus der E-Mail").fill(codeFrom(mail.text));
  await page.getByRole("button", { name: "Anmelden" }).click();
}

/** Visible cards only (React may keep hidden streamed copies in the DOM). */
export const card = (page: Page, title: string) =>
  page.locator('[aria-roledescription="verschiebbare Aufgabe"]', { hasText: title }).filter({ visible: true });

export const column = (page: Page, label: string) => page.getByRole("region", { name: new RegExp(`^${label}`) });
