import { describe, expect, it } from "vitest";
import {
  applyEditorChange,
  editorToMarkup,
  extractMentionIds,
  markupToEditor,
  matchesMentionQuery,
  MENTION_ALL_TOKEN,
  mentionsAll,
  mentionToken,
  renderMentionsPlain,
  splitMentions,
} from "../src/mentions";

const FELIX = "11111111-1111-4111-8111-111111111111";
const ANNA = "22222222-2222-4222-8222-222222222222";
const names: Record<string, string> = { [FELIX]: "Felix Muster", [ANNA]: "Anna Beispiel" };
const nameOf = (id: string) => names[id];

describe("mention markup", () => {
  it("leaves plain bodies untouched", () => {
    expect(splitMentions("Hallo <b>@Felix</b> <@nope>")).toEqual([{ type: "text", text: "Hallo <b>@Felix</b> <@nope>" }]);
    expect(extractMentionIds("kein Token")).toEqual([]);
  });

  it("extracts distinct ids in order, case-insensitive", () => {
    const body = `${mentionToken(ANNA)} und <@${FELIX.toUpperCase()}> und ${mentionToken(ANNA)}`;
    expect(extractMentionIds(body)).toEqual([ANNA, FELIX]);
  });

  it("renders plain text with current names", () => {
    expect(renderMentionsPlain(`Hey ${mentionToken(FELIX)}, schau mal`, nameOf)).toBe("Hey @Felix Muster, schau mal");
    expect(renderMentionsPlain(mentionToken("33333333-3333-4333-8333-333333333333"), nameOf)).toBe("@Ehemaliges Mitglied");
  });

  it("round-trips through the editor model", () => {
    const markup = `Hey ${mentionToken(FELIX)} und ${mentionToken(ANNA)}!`;
    const ed = markupToEditor(markup, nameOf);
    expect(ed.text).toBe("Hey @Felix Muster und @Anna Beispiel!");
    expect(ed.text.slice(ed.mentions[0].start, ed.mentions[0].end)).toBe("@Felix Muster");
    expect(editorToMarkup(ed.text, ed.mentions)).toBe(markup);
  });
});

describe("@all", () => {
  const markup = `${MENTION_ALL_TOKEN} und ${mentionToken(FELIX)}`;

  it("is a segment of its own, not a user id", () => {
    expect(splitMentions(markup)[0]).toEqual({ type: "all" });
    expect(splitMentions("<@ALL>")).toEqual([{ type: "all" }]);
    expect(extractMentionIds(markup)).toEqual([FELIX]);
    expect(mentionsAll(markup)).toBe(true);
    expect(mentionsAll("Hallo @all")).toBe(false);
  });

  it("renders as @all and round-trips through the editor model", () => {
    expect(renderMentionsPlain(markup, nameOf)).toBe("@all und @Felix Muster");
    const ed = markupToEditor(markup, nameOf);
    expect(ed.text).toBe("@all und @Felix Muster");
    expect(ed.mentions[0]).toEqual({ start: 0, end: 4, all: true });
    expect(editorToMarkup(ed.text, ed.mentions)).toBe(markup);
  });

  it("typed @all without picking it stays plain text", () => {
    expect(editorToMarkup("@all hallo", [])).toBe("@all hallo");
  });
});

describe("applyEditorChange (atomic mentions)", () => {
  const base = markupToEditor(`Hey ${mentionToken(FELIX)} und ${mentionToken(ANNA)}`, nameOf);

  it("shifts mentions after a change", () => {
    const next = "Oh " + base.text;
    const r = applyEditorChange(base.text, next, base.mentions);
    expect(editorToMarkup(r.text, r.mentions)).toBe(`Oh Hey ${mentionToken(FELIX)} und ${mentionToken(ANNA)}`);
  });

  it("keeps a mention when typing right after it", () => {
    const at = base.mentions[0].end;
    const next = base.text.slice(0, at) + "," + base.text.slice(at);
    const r = applyEditorChange(base.text, next, base.mentions);
    expect(editorToMarkup(r.text, r.mentions)).toBe(`Hey ${mentionToken(FELIX)}, und ${mentionToken(ANNA)}`);
  });

  it("removes a mention completely when one character inside is deleted", () => {
    const m = base.mentions[0];
    const next = base.text.slice(0, m.end - 1) + base.text.slice(m.end); // backspace at its end
    const r = applyEditorChange(base.text, next, base.mentions);
    expect(r.text).toBe(`Hey  und @Anna Beispiel`);
    expect(r.caret).toBe(4);
    expect(editorToMarkup(r.text, r.mentions)).toBe(`Hey  und ${mentionToken(ANNA)}`);
  });

  it("removes a mention when typing inside it, keeping the typed text", () => {
    const m = base.mentions[1];
    const next = base.text.slice(0, m.start + 2) + "X" + base.text.slice(m.start + 2);
    const r = applyEditorChange(base.text, next, base.mentions);
    expect(r.text).toBe("Hey @Felix Muster und X");
    expect(r.mentions).toHaveLength(1);
  });
});

describe("matchesMentionQuery", () => {
  const p = { fullName: "Felix Müller", email: "fm@vistoo.de" };
  it("matches first and last names, diacritics-insensitive", () => {
    expect(matchesMentionQuery(p, "fe")).toBe(true);
    expect(matchesMentionQuery(p, "mul")).toBe(true);
    expect(matchesMentionQuery(p, "Felix M")).toBe(true);
    expect(matchesMentionQuery(p, "lix")).toBe(false);
  });
  it("falls back to the e-mail local part", () => {
    expect(matchesMentionQuery({ fullName: null, email: "jana.k@x.de" }, "jana")).toBe(true);
  });
});
