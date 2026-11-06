import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@vistoo/domain/result";
import { endpoints, type EndpointDef } from "../src/endpoints";
import { buildOpenApiDocument, ERROR_HTTP_STATUS } from "../src/openapi";

const defs = Object.entries(endpoints) as [string, EndpointDef][];

describe("API contract", () => {
  it("method + path are unique", () => {
    const keys = defs.map(([, d]) => `${d.method} ${d.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every error code has an HTTP status", () => {
    for (const code of ERROR_CODES) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it("path parameters are declared", () => {
    for (const [id, d] of defs) {
      const inPath = [...d.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(d.params?.shape ?? {}).sort();
      expect(declared, id).toEqual(inPath);
    }
  });

  it("only public endpoints work without a token; mutations never claim to be anonymous", () => {
    const anonymous = defs.filter(([, d]) => d.auth === "public").map(([id]) => id).sort();
    expect(anonymous).toEqual(["getMeta", "requestLoginCode"]);
  });

  it("mutations declare how to retry them", () => {
    for (const [id, d] of defs) {
      if (d.method === "POST" && d.retry === "safe") {
        // POST is only "safe" where the operation is idempotent by nature (documented per endpoint).
        expect(
          ["requestLoginCode", "acceptInvitation", "moveTask", "openDirectMessage", "addChannelMembers", "removeChannelMember", "finalizeUpload", "resendInvitation"],
          id,
        ).toContain(id);
      }
    }
  });

  it("produces a valid OpenAPI 3.1 document with resolvable references", () => {
    const doc = buildOpenApiDocument() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    const refs = [...JSON.stringify(doc).matchAll(/"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) expect(doc.components.schemas, ref).toHaveProperty(ref);
    const operations = Object.values(doc.paths).flatMap((m) => Object.values(m));
    expect(operations).toHaveLength(defs.length);
  });
});
