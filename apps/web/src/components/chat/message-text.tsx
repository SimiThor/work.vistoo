import { Fragment } from "react";
import type { IssueRefDTO } from "@vistoo/domain";
import { splitIssueRefs } from "@vistoo/domain/issue-refs";
import { splitMentions } from "@vistoo/domain/mentions";
import { IssueRefLink } from "./issue-refs";
import { MentionAll, MentionLink } from "./mention-link";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

function linkify(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const trail = raw.match(TRAILING)?.[0] ?? "";
    const url = trail ? raw.slice(0, -trail.length) : raw;
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={`${keyPrefix}-${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-accent-blue-text underline decoration-accent-blue/30 underline-offset-2 hover:decoration-accent-blue"
      >
        {url}
      </a>,
    );
    if (trail) parts.push(trail);
    last = start + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Message markup as plain text with clickable http(s) links, highlighted
 * mentions and `#24` issue links. No HTML, no markdown: React escapes everything; only link and
 * mention elements are generated. Names are resolved at render time, so a
 * renamed person shows the new name.
 */
export function MessageText({
  text,
  nameOf,
  me,
  issueRefs,
}: {
  /** Markup (mentions as `<@user-id>` or `<@all>`). */
  text: string;
  nameOf: (userId: string) => string | null;
  me: string | null;
  /** Server-resolved references of this message; others are looked up in the client cache. */
  issueRefs?: readonly IssueRefDTO[];
}) {
  const refById = new Map((issueRefs ?? []).map((r) => [r.id, r]));
  const parts: React.ReactNode[] = [];
  splitMentions(text).forEach((seg, i) => {
    if (seg.type === "text") {
      splitIssueRefs(seg.text).forEach((part, j) => {
        if (part.type === "text") parts.push(...linkify(part.text, `${i}-${j}`));
        else parts.push(<IssueRefLink key={`i-${i}-${j}`} taskId={part.taskId} fallback={refById.get(part.taskId)} />);
      });
      return;
    }
    if (seg.type === "all") {
      parts.push(<MentionAll key={`a-${i}`} />);
      return;
    }
    const name = nameOf(seg.userId) ?? "Ehemaliges Mitglied";
    parts.push(<MentionLink key={`m-${i}`} userId={seg.userId} name={name} me={me} />);
  });
  return (
    <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}
