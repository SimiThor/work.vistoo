/**
 * Chat mentions: storage format and pure helpers shared by server and clients.
 *
 * Storage ("markup"): a mention is the token `<@user-uuid>` inside the message
 * body. The token carries only the stable user id; the visible name is
 * resolved at display time, so renaming a person updates every mention.
 * Bodies without tokens (all messages before this feature) stay unchanged.
 *
 * `<@all>` mentions everyone who can read the conversation (open channel:
 * active workspace members, otherwise participants). The server resolves the
 * recipients when the message is sent; the author is never notified.
 *
 * Editing ("editor model"): clients show plain text where each mention reads
 * `@Display Name` and keep the mention ranges next to it. Converting back
 * yields markup again.
 */

import { formatIssueNumber, issueRefToken, MISSING_ISSUE_LABEL, splitIssueRefs } from "./issue-refs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const tokenRe = () => new RegExp(`<@(${UUID}|all)>`, "gi");

export const mentionToken = (userId: string) => `<@${userId.toLowerCase()}>`;

/** Token that mentions everyone in the conversation. */
export const MENTION_ALL_TOKEN = "<@all>";
/** Visible label of `<@all>` (editor, previews, plain `body`). */
export const MENTION_ALL_LABEL = "@all";

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string }
  | { type: "all" };

/** Splits markup into text and mention segments (in order). */
export function splitMentions(markup: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of markup.matchAll(tokenRe())) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", text: markup.slice(last, start) });
    const target = m[1].toLowerCase();
    out.push(target === "all" ? { type: "all" } : { type: "mention", userId: target });
    last = start + m[0].length;
  }
  if (last < markup.length) out.push({ type: "text", text: markup.slice(last) });
  return out;
}

/** Distinct individually mentioned user ids, in order of first appearance (without `<@all>`). */
export function extractMentionIds(markup: string): string[] {
  const ids = new Set<string>();
  for (const m of markup.matchAll(tokenRe())) {
    const target = m[1].toLowerCase();
    if (target !== "all") ids.add(target);
  }
  return [...ids];
}

/** Whether the markup contains `<@all>`. */
export function mentionsAll(markup: string): boolean {
  return /<@all>/i.test(markup);
}

/** Plain text with every mention rendered as `@Name` (previews, old clients). */
export function renderMentionsPlain(markup: string, nameOf: (userId: string) => string | null | undefined): string {
  return splitMentions(markup)
    .map((s) =>
      s.type === "text" ? s.text : s.type === "all" ? MENTION_ALL_LABEL : `@${nameOf(s.userId) ?? "Ehemaliges Mitglied"}`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Editor model
// ---------------------------------------------------------------------------

/**
 * An atomic range inside editor text: a person mention
 * (`text.slice(start, end) === "@Name"`), `@all`, or an issue reference
 * (`"#24"`, see ./issue-refs). All behave the same while editing.
 */
export type EditorMention =
  | { start: number; end: number; userId: string; taskId?: undefined; all?: undefined }
  | { start: number; end: number; taskId: string; userId?: undefined; all?: undefined }
  | { start: number; end: number; all: true; userId?: undefined; taskId?: undefined };

/**
 * `issueNumberOf` resolves `<#task-id>` tokens to `#24`; without it (or for
 * unknown tasks) they stay as atomic ranges labelled with the missing label.
 */
export function markupToEditor(
  markup: string,
  nameOf: (userId: string) => string | null | undefined,
  issueNumberOf?: (taskId: string) => number | null | undefined,
): { text: string; mentions: EditorMention[] } {
  let text = "";
  const mentions: EditorMention[] = [];
  for (const s of splitMentions(markup)) {
    if (s.type === "text") {
      for (const part of splitIssueRefs(s.text)) {
        if (part.type === "text") {
          text += part.text;
          continue;
        }
        const n = issueNumberOf?.(part.taskId);
        const label = n ? formatIssueNumber(n) : MISSING_ISSUE_LABEL;
        mentions.push({ start: text.length, end: text.length + label.length, taskId: part.taskId });
        text += label;
      }
    } else if (s.type === "all") {
      mentions.push({ start: text.length, end: text.length + MENTION_ALL_LABEL.length, all: true });
      text += MENTION_ALL_LABEL;
    } else {
      const label = `@${nameOf(s.userId) ?? "Ehemaliges Mitglied"}`;
      mentions.push({ start: text.length, end: text.length + label.length, userId: s.userId });
      text += label;
    }
  }
  return { text, mentions };
}

export function editorToMarkup(text: string, mentions: readonly EditorMention[]): string {
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const m of sorted) {
    if (m.start < last || m.end > text.length) continue; // defensive: overlapping / stale range
    const token = m.all ? MENTION_ALL_TOKEN : m.taskId !== undefined ? issueRefToken(m.taskId) : mentionToken(m.userId);
    out += text.slice(last, m.start) + token;
    last = m.end;
  }
  return out + text.slice(last);
}

/**
 * Applies a plain text change to the mention ranges. Mentions are atomic: a
 * change that touches a mention removes it completely (its remaining text is
 * dropped too), mentions after the change shift.
 *
 * Returns the (possibly corrected) text and the surviving mentions plus the
 * caret position to restore.
 */
export function applyEditorChange(
  prevText: string,
  nextText: string,
  mentions: readonly EditorMention[],
): { text: string; mentions: EditorMention[]; caret: number | null } {
  if (prevText === nextText) return { text: nextText, mentions: [...mentions], caret: null };
  // Changed region: common prefix / suffix.
  let start = 0;
  const minLen = Math.min(prevText.length, nextText.length);
  while (start < minLen && prevText[start] === nextText[start]) start++;
  let endPrev = prevText.length;
  let endNext = nextText.length;
  while (endPrev > start && endNext > start && prevText[endPrev - 1] === nextText[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const inserted = nextText.slice(start, endNext);

  // Replaced range in OLD coordinates, widened to cover every mention it
  // touches. A pure insertion exactly at a mention boundary keeps the mention.
  let cutStart = start;
  let cutEnd = endPrev;
  const touches = (m: EditorMention) =>
    cutStart === cutEnd ? cutStart > m.start && cutStart < m.end : cutStart < m.end && cutEnd > m.start;
  let widened = false;
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of mentions) {
      if (touches(m) && (m.start < cutStart || m.end > cutEnd)) {
        cutStart = Math.min(cutStart, m.start);
        cutEnd = Math.max(cutEnd, m.end);
        changed = widened = true;
      }
    }
  }

  const text = prevText.slice(0, cutStart) + inserted + prevText.slice(cutEnd);
  const shift = inserted.length - (cutEnd - cutStart);
  const kept: EditorMention[] = [];
  for (const m of mentions) {
    if (m.end <= cutStart) kept.push({ ...m });
    else if (m.start >= cutEnd) kept.push({ ...m, start: m.start + shift, end: m.end + shift });
    // else: inside the replaced range → removed as a whole
  }
  return { text, mentions: kept, caret: widened ? cutStart + inserted.length : null };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Whether a person matches the text typed after `@`: any name part (first or
 * last name) or the full name starts with the query; e-mail local part as a
 * fallback for people without a name.
 */
export function matchesMentionQuery(person: { fullName: string | null; email: string }, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const name = fold(person.fullName?.trim() ?? "");
  const local = fold(person.email.split("@")[0]);
  if (name.startsWith(q) || local.startsWith(q)) return true;
  return name.split(/[\s\-.]+/).some((part) => part.startsWith(q));
}
