import { Fragment } from "react";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/**
 * Plain text with clickable http(s) links. No HTML, no markdown: React
 * escapes everything; only the link elements are generated.
 */
export function MessageText({ text }: { text: string }) {
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
        key={start}
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
  return (
    <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}
