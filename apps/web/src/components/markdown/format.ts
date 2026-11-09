/**
 * Pure Markdown editing helpers for the toolbar, shortcuts and list
 * continuation. Each returns one text replacement plus the new selection, so
 * the editor can apply it as a single, undoable edit.
 */

export type Edit = {
  /** Replace `value.slice(from, to)` with `insert`. */
  from: number;
  to: number;
  insert: string;
  /** Selection afterwards, in the new text. */
  selStart: number;
  selEnd: number;
};

export type Format = "bold" | "italic" | "heading" | "link" | "bullet" | "number" | "task" | "code";

export function applyEdit(value: string, e: Edit): string {
  return value.slice(0, e.from) + e.insert + value.slice(e.to);
}

export function formatSelection(value: string, start: number, end: number, format: Format): Edit {
  switch (format) {
    case "bold":
      return wrap(value, start, end, "**");
    case "italic":
      return wrap(value, start, end, "_");
    case "link":
      return link(value, start, end);
    case "code":
      return code(value, start, end);
    default:
      return prefixLines(value, start, end, format);
  }
}

function wrap(value: string, start: number, end: number, marker: string): Edit {
  const m = marker.length;
  const sel = value.slice(start, end);
  // Already wrapped (markers just outside the selection): unwrap.
  if (start >= m && value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { from: start - m, to: end + m, insert: sel, selStart: start - m, selEnd: end - m };
  }
  // Markers selected too: unwrap.
  if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(m, -m);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  // Keep surrounding whitespace outside the markers (`** text**` is not bold).
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.trim();
  const insert = sel.slice(0, lead) + marker + core + marker + sel.slice(sel.length - trail);
  const innerStart = start + lead + m;
  return { from: start, to: end, insert, selStart: innerStart, selEnd: innerStart + core.length };
}

function link(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end);
  if (/^https?:\/\/\S+$/i.test(sel.trim())) {
    return { from: start, to: end, insert: `[](${sel.trim()})`, selStart: start + 1, selEnd: start + 1 };
  }
  const insert = `[${sel}](url)`;
  const urlStart = start + sel.length + 3;
  return { from: start, to: end, insert, selStart: urlStart, selEnd: urlStart + 3 };
}

function code(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end);
  if (sel && !sel.includes("\n")) return wrap(value, start, end, "`");
  // Fenced block on its own lines.
  const before = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const after = end < value.length && value[end] !== "\n" ? "\n" : "";
  const body = sel.replace(/\n$/, "");
  const insert = `${before}\`\`\`\n${body}\n\`\`\`${after}`;
  const bodyStart = start + before.length + 4;
  return { from: start, to: end, insert, selStart: bodyStart, selEnd: bodyStart + body.length };
}

const LIST_PREFIX = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
const PREFIX: Record<"heading" | "bullet" | "number" | "task", RegExp> = {
  heading: /^(\s*)#{1,6}\s+/,
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\])/,
  number: /^(\s*)\d{1,9}[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
};

function prefixLines(value: string, start: number, end: number, kind: keyof typeof PREFIX): Edit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  // A selection ending right after a newline does not include the next line.
  const endAt = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", endAt);
  const to = nl === -1 ? value.length : nl;
  const lines = value.slice(from, to).split("\n");
  const content = lines.filter((l) => l.trim() !== "");
  const remove = content.length > 0 && content.every((l) => PREFIX[kind].test(l));

  let n = 0;
  const next = lines.map((line) => {
    if (remove) return line.replace(PREFIX[kind], "$1");
    if (line.trim() === "" && lines.length > 1) return line;
    const indent = /^\s*/.exec(line)![0];
    const text = line.slice(indent.length).replace(kind === "heading" ? PREFIX.heading : LIST_PREFIX, "");
    const marker = kind === "heading" ? "### " : kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${++n}. `;
    return indent + marker + text.replace(/^#{1,6}\s+/, kind === "heading" ? "" : "$&");
  });
  const insert = next.join("\n");
  // Collapsed cursor on one line: keep it at the end of the text; otherwise select the block.
  if (start === end && lines.length === 1) {
    const pos = from + insert.length;
    return { from, to, insert, selStart: pos, selEnd: pos };
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

const CONTINUE = /^(\s*(?:>\s?)*)([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/;

/**
 * Enter inside a list item continues the list (GitHub behaviour): new bullet,
 * next number, new unchecked box. Enter on an empty item ends the list.
 * Returns `null` when the default newline should happen.
 */
export function continueList(value: string, start: number, end: number): Edit | null {
  if (start !== end) return null;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", start);
  const lineEnd = nl === -1 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);
  const m = CONTINUE.exec(line);
  if (!m || start < lineStart + m[0].length) return null;
  // Inside a fenced code block: plain newline.
  const fences = value.slice(0, lineStart).match(/^\s*(```|~~~)/gm);
  if (fences && fences.length % 2 === 1) return null;

  const [whole, indent, bullet, num, delim, space, box] = m;
  if (line.slice(whole.length).trim() === "") {
    // Empty item: end the list, keep the line.
    return { from: lineStart, to: lineEnd, insert: "", selStart: lineStart, selEnd: lineStart };
  }
  const marker = num !== undefined ? `${Number(num) + 1}${delim}` : bullet;
  const insert = `\n${indent}${marker}${space}${box ? "[ ] " : ""}`;
  return { from: start, to: start, insert, selStart: start + insert.length, selEnd: start + insert.length };
}
