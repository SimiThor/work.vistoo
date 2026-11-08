import { describe, expect, it } from "vitest";
import { isWebUrl, linkFallbackTitle, linkKind, normalizeWebUrl } from "../src/links";
import { createTaskLinkSchema, meetingUrlSchema, webUrlSchema } from "../src/validation";

describe("web links", () => {
  it("normalizes input and adds https to scheme-less links", () => {
    expect(normalizeWebUrl("  figma.com/file/abc  ")).toBe("https://figma.com/file/abc");
    expect(normalizeWebUrl("https://GitHub.com/vistoo")).toBe("https://github.com/vistoo");
    expect(webUrlSchema.parse("docs.google.com/document/d/1")).toBe("https://docs.google.com/document/d/1");
  });

  it("accepts only http(s) URLs with a real host and no credentials", () => {
    expect(isWebUrl("https://drive.google.com/drive/folders/x")).toBe(true);
    expect(isWebUrl("http://localhost:3100/tasks")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "mailto:team@vistoo.de",
      "ftp://example.com",
      "https://user:pw@example.com",
      "https://intranet",
    ]) {
      expect(isWebUrl(bad), bad).toBe(false);
    }
    expect(webUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(webUrlSchema.safeParse("   ").success).toBe(false);
    expect(webUrlSchema.safeParse(`https://example.com/${"a".repeat(2100)}`).success).toBe(false);
  });

  it("title is optional and trimmed", () => {
    const taskId = "6f1e0c1a-4f3b-4a8e-9d7c-2b5a1c3d4e5f";
    expect(createTaskLinkSchema.parse({ taskId, url: "example.com" }).title).toBeNull();
    expect(createTaskLinkSchema.parse({ taskId, url: "example.com", title: "  Briefing " }).title).toBe("Briefing");
    expect(meetingUrlSchema.parse({ meetingUrl: null }).meetingUrl).toBeNull();
  });

  it("detects the link kind for icons", () => {
    expect(linkKind("https://docs.google.com/spreadsheets/d/1")).toBe("spreadsheet");
    expect(linkKind("https://docs.google.com/presentation/d/1")).toBe("presentation");
    expect(linkKind("https://docs.google.com/document/d/1")).toBe("document");
    expect(linkKind("https://drive.google.com/file/d/1")).toBe("drive");
    expect(linkKind("https://www.figma.com/design/abc")).toBe("figma");
    expect(linkKind("https://github.com/vistoo/app/pull/1")).toBe("github");
    expect(linkKind("https://vistoo.de")).toBe("web");
  });

  it("builds a readable fallback title", () => {
    expect(linkFallbackTitle("https://www.github.com/vistoo/app/pull/12/")).toBe("github.com/vistoo/app/pull/12");
    expect(linkFallbackTitle("https://vistoo.de/")).toBe("vistoo.de");
  });
});
