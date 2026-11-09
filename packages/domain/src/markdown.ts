/**
 * Markdown checklists in task descriptions (GitHub Flavored Markdown).
 *
 * The description is stored as Markdown source. Checklist items (`- [ ] …`,
 * `- [x] …`, also nested, numbered or inside quotes) can be ticked directly in
 * the rendered view. Ticking changes exactly one character in the source; the
 * rest of the text stays byte-for-byte identical.
 *
 * Items are found with the same parser and extensions as the renderer
 * (micromark + GFM, as used by `react-markdown` + `remark-gfm`), so the n-th
 * checkbox on screen is the n-th item here, and checkboxes inside code
 * blocks are never matched.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export type ChecklistItem = {
  /** Position among all checklist items, in document order. */
  index: number;
  /** Source offset where the list item starts (its bullet or number). */
  itemStart: number;
  /** Source offset of the character between the brackets (` `, `x` or `X`). */
  markOffset: number;
  checked: boolean;
  /** First line of the item's text, trimmed. Identifies the item across edits. */
  text: string;
};

type Node = {
  type: string;
  checked?: boolean | null;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const CHECKBOX = /\[([ xX])\]/g;

/** All checklist items in document order. */
export function listChecklistItems(source: string): ChecklistItem[] {
  if (!source.includes("[")) return [];
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Node;
  const items: ChecklistItem[] = [];

  const visit = (node: Node) => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const item = locate(source, node, items.length);
      if (item) items.push(item);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return items;
}

function locate(source: string, node: Node, index: number): ChecklistItem | null {
  const itemStart = node.position?.start.offset;
  if (itemStart === undefined) return null;
  // The checkbox sits between the bullet and the start of the item's text.
  // The parser moves the first text node's start past `[x] `.
  const paragraph = node.children?.[0];
  const textStart = firstTextOffset(paragraph) ?? paragraph?.position?.end.offset ?? node.position?.end.offset;
  if (textStart === undefined) return null;
  const head = source.slice(itemStart, textStart);
  let match: RegExpExecArray | null = null;
  for (const m of head.matchAll(CHECKBOX)) match = m;
  if (!match || match.index === undefined) return null;
  const markOffset = itemStart + match.index + 1;
  const lineEnd = source.indexOf("\n", textStart);
  const text = source.slice(Math.max(textStart, markOffset + 2), lineEnd === -1 ? undefined : lineEnd).trim();
  return { index, itemStart, markOffset, checked: node.checked === true, text };
}

function firstTextOffset(node: Node | undefined): number | undefined {
  let cur = node;
  while (cur) {
    if (cur.type !== "paragraph" && cur.children === undefined) return cur.position?.start.offset;
    cur = cur.children?.[0];
  }
  return undefined;
}

/**
 * Sets one checklist item to `checked`. `text` is the item's text as the user
 * saw it: if the item at `index` no longer has that text (someone edited the
 * description meanwhile), the item is looked up by its text instead. Returns
 * `null` when the item cannot be identified unambiguously.
 */
export function setChecklistItem(source: string, index: number, checked: boolean, text?: string): string | null {
  const items = listChecklistItems(source);
  let item: ChecklistItem | undefined = items[index];
  if (text !== undefined && item?.text !== text.trim()) {
    const same = items.filter((i) => i.text === text.trim());
    item = same.length === 1 ? same[0] : undefined;
  }
  if (!item) return null;
  if (item.checked === checked) return source;
  return source.slice(0, item.markOffset) + (checked ? "x" : " ") + source.slice(item.markOffset + 1);
}

/** Progress of the checklist, e.g. for a "2/5" badge. */
export function checklistProgress(source: string): { done: number; total: number } {
  const items = listChecklistItems(source);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}
