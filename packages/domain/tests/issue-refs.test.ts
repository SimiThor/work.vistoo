import { describe, expect, it } from "vitest";
import {
  extractIssueRefIds,
  issueQueryScore,
  issueRefToken,
  MISSING_ISSUE_LABEL,
  rankIssues,
  renderIssueRefsPlain,
  splitIssueRefs,
} from "../src/issue-refs";

const A = "0b3b5f0e-6f2c-4f7a-9d55-1f7d8c1b2a10";
const B = "9f1c6a2e-3d4b-4c5d-8e6f-7a8b9c0d1e2f";
const U = "1f1c6a2e-3d4b-4c5d-8e6f-7a8b9c0d1e2f";

describe("issue reference markup", () => {
  it("splits multiple references and keeps mention tokens as text", () => {
    const markup = `<@${U}> bitte ${issueRefToken(A)} und ${issueRefToken(B.toUpperCase())} ansehen`;
    expect(splitIssueRefs(markup)).toEqual([
      { type: "text", text: `<@${U}> bitte ` },
      { type: "issue", taskId: A },
      { type: "text", text: " und " },
      { type: "issue", taskId: B },
      { type: "text", text: " ansehen" },
    ]);
    expect(extractIssueRefIds(`${markup} ${issueRefToken(A)}`)).toEqual([A, B]);
  });

  it("ignores plain #numbers and malformed tokens", () => {
    expect(extractIssueRefIds("Siehe #24 und <#nope> und <@" + A + ">")).toEqual([]);
  });

  it("renders numbers, or a label for deleted/hidden tasks", () => {
    const plain = renderIssueRefsPlain(`Fix ${issueRefToken(A)}, ${issueRefToken(B)}`, (id) => (id === A ? 24 : null));
    expect(plain).toBe(`Fix #24, ${MISSING_ISSUE_LABEL}`);
  });
});

describe("# picker ranking", () => {
  const tasks = [
    { number: 12, title: "Implement AR navigation" },
    { number: 18, title: "Improve onboarding" },
    { number: 24, title: "Fix dashboard layout" },
    { number: 2, title: "Übersicht überarbeiten" },
    { number: 245, title: "Logo" },
  ];
  it("exact number before prefix matches", () => {
    expect(rankIssues(tasks, "#24", 8).map((t) => t.number)).toEqual([24, 245]);
    expect(rankIssues(tasks, "2", 8).map((t) => t.number)).toEqual([2, 245, 24]);
  });
  it("title word prefixes, case and accent insensitive", () => {
    expect(rankIssues(tasks, "uebersicht", 8)).toEqual([]);
    expect(rankIssues(tasks, "ubers", 8).map((t) => t.number)).toEqual([2]);
    expect(rankIssues(tasks, "dash lay", 8).map((t) => t.number)).toEqual([24]);
    expect(issueQueryScore(tasks[0], "nav")).toBeGreaterThan(0);
    expect(issueQueryScore(tasks[0], "xyz")).toBe(0);
  });
  it("empty query lists newest first, limited", () => {
    expect(rankIssues(tasks, "", 3).map((t) => t.number)).toEqual([245, 24, 18]);
  });
});
