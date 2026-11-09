import { describe, expect, it } from "vitest";
import {
  completionErrors,
  createDecisionSchema,
  isStatusOfType,
  previewOf,
  statusForType,
  supersedeDecisionSchema,
  teamToday,
} from "../src/decisions";

const id = "7d1d3f6e-1c4b-4a8e-9b3a-2f1e0c9d8b7a";

describe("decisions domain rules", () => {
  it("each type has its own statuses; switching type keeps the stage", () => {
    expect(isStatusOfType("decision", "decided")).toBe(true);
    expect(isStatusOfType("decision", "adopted")).toBe(false);
    expect(statusForType("experiment", "open")).toBe("planned");
    expect(statusForType("experiment", "in_discussion")).toBe("testing");
    expect(statusForType("decision", "testing")).toBe("in_discussion");
    expect(statusForType("decision", "decided")).toBe("decided");
  });

  it("concluding needs a result and reasoning, open entries need nothing", () => {
    const empty = { results: "", outcome: "", reasoning: "" };
    expect(completionErrors({ type: "decision", status: "in_discussion", ...empty })).toEqual({});
    expect(Object.keys(completionErrors({ type: "decision", status: "decided", ...empty }))).toEqual(["outcome", "reasoning"]);
    expect(completionErrors({ type: "decision", status: "decided", ...empty, outcome: "Railway", reasoning: "  " })).toHaveProperty(
      "reasoning",
    );
    // Experiments only need their result – no conclusion or reasoning.
    expect(completionErrors({ type: "experiment", status: "rejected", ...empty })).toEqual({ results: expect.any(String) });
    expect(completionErrors({ type: "experiment", status: "rejected", ...empty, outcome: "Fazit" })).toHaveProperty("results");
    expect(completionErrors({ type: "experiment", status: "rejected", ...empty, results: "Zu aufwendig" })).toEqual({});
  });

  it("only the title is required to create; supersede needs exactly one target", () => {
    expect(createDecisionSchema.parse({ title: "  Hosting  " })).toMatchObject({ title: "Hosting", type: "decision" });
    expect(() => createDecisionSchema.parse({ title: " " })).toThrow();
    expect(() => supersedeDecisionSchema.parse({ id })).toThrow();
    expect(() => supersedeDecisionSchema.parse({ id, successorId: id, newTitle: "x" })).toThrow();
    expect(supersedeDecisionSchema.parse({ id, newTitle: "Hetzner" })).toMatchObject({ newTitle: "Hetzner" });
  });

  it("the automatic decision day is the team's day, not the server's or viewer's", () => {
    expect(teamToday(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09"); // already Monday in Berlin
    expect(teamToday(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01"); // summer time
  });

  it("the list preview is one short line", () => {
    expect(previewOf("  Railway\n\n(vorerst)  ")).toBe("Railway (vorerst)");
    expect(previewOf("x".repeat(500))).toHaveLength(180);
  });
});
