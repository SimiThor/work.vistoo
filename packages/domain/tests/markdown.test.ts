import { describe, expect, it } from "vitest";
import { checklistProgress, listChecklistItems, setChecklistItem } from "../src/markdown";

const doc = `## Aufgaben

- [x] Datenbankstruktur erstellen
- [ ] API implementieren
  - [ ] Endpunkte
  - [X] Tests
- [ ] Frontend entwickeln

1. [ ] Nummeriert
> - [ ] Im Zitat

\`\`\`md
- [ ] im Codeblock
\`\`\`

Text mit [ ] Klammern und [x] mitten im Satz.
- normale Liste
- [ ] mit [x] im Text
`;

describe("listChecklistItems", () => {
  it("finds items in document order, incl. nested, numbered and quoted ones", () => {
    const items = listChecklistItems(doc);
    expect(items.map((i) => [i.text, i.checked])).toEqual([
      ["Datenbankstruktur erstellen", true],
      ["API implementieren", false],
      ["Endpunkte", false],
      ["Tests", true],
      ["Frontend entwickeln", false],
      ["Nummeriert", false],
      ["Im Zitat", false],
      ["mit [x] im Text", false],
    ]);
    for (const i of items) expect(doc[i.markOffset - 1] + doc[i.markOffset + 1]).toBe("[]");
  });

  it("ignores code blocks, inline brackets and plain lists", () => {
    expect(listChecklistItems("```\n- [ ] a\n```\n\n    - [ ] indented code\n\n- a\n- [] b")).toEqual([]);
  });

  it("handles CRLF line endings and other bullets", () => {
    const items = listChecklistItems("* [ ] a\r\n+ [x] b\r\n");
    expect(items.map((i) => [i.text, i.checked])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("setChecklistItem", () => {
  it("changes exactly one character", () => {
    const next = setChecklistItem(doc, 2, true, "Endpunkte")!;
    expect(next.length).toBe(doc.length);
    const diff = [...doc].filter((c, i) => c !== next[i]);
    expect(diff).toEqual([" "]);
    expect(listChecklistItems(next)[2].checked).toBe(true);
    expect(setChecklistItem(next, 3, false)).toContain("  - [ ] Tests");
  });

  it("does not touch the code block or the item text", () => {
    const next = setChecklistItem(doc, 7, true)!;
    expect(next).toContain("- [ ] im Codeblock");
    expect(next).toContain("- [x] mit [x] im Text");
  });

  it("is a no-op when already in the requested state", () => {
    expect(setChecklistItem(doc, 0, true)).toBe(doc);
  });

  it("follows the item by text when lines were inserted meanwhile", () => {
    const edited = doc.replace("- [x] Datenbankstruktur", "- [ ] Neu oben\n- [x] Datenbankstruktur");
    const next = setChecklistItem(edited, 1, true, "API implementieren")!;
    expect(next).toContain("- [x] API implementieren");
    expect(next).toContain("- [ ] Neu oben");
  });

  it("refuses when the item is gone or ambiguous", () => {
    expect(setChecklistItem(doc, 1, true, "Gibt es nicht")).toBeNull();
    expect(setChecklistItem("- [ ] a\n- [ ] a\n- [ ] b", 2, true, "a")).toBeNull();
    expect(setChecklistItem(doc, 99, true)).toBeNull();
  });
});

describe("checklistProgress", () => {
  it("counts done items", () => {
    expect(checklistProgress(doc)).toEqual({ done: 2, total: 8 });
    expect(checklistProgress("")).toEqual({ done: 0, total: 0 });
  });
});
