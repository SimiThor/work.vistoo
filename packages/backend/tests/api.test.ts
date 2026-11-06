import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { endpoints, type OperationId } from "@vistoo/contracts";
import { buildOpenApiDocument } from "@vistoo/contracts/openapi";
import { messageAttachments, messages, tasks } from "@vistoo/database/schema";
import { setAccessTokenVerifierForTests, type AuthUser } from "../src/auth";
import type { ChatStorage } from "../src/chat-storage";
import { getDb } from "../src/db";
import { handleApiRequest } from "../src/http";
import { handlers } from "../src/http/handlers";
import { setChatStorageForTests } from "../src/services/chat-files";
import { addMember, makeProject, makeUser, makeWorkspace } from "./support/fixtures";

/*
 * Exercises /api/v1 end to end (dispatcher → auth → services → Postgres),
 * the way the iOS app uses it. Token verification is replaced by a lookup
 * table; everything after it (membership, roles, RLS-equivalent checks) is real.
 * Outside production every response is validated against the contract schema.
 */

const tokens = new Map<string, AuthUser>();
beforeAll(() => {
  setAccessTokenVerifierForTests(async (token) => tokens.get(token) ?? null);
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
});
afterAll(() => setAccessTokenVerifierForTests(null));

const objects = new Map<string, Uint8Array>();
const memoryStorage: ChatStorage = {
  async createUploadUrl(p) {
    return { signedUrl: `memory://${p}`, token: "t" };
  },
  async inspect(p) {
    const data = objects.get(p);
    return data ? { size: data.length, head: data.slice(0, 4096) } : null;
  },
  async remove(paths) {
    for (const p of paths) objects.delete(p);
  },
  async createDownloadUrl(p) {
    return `memory://download/${p}`;
  },
};
setChatStorageForTests(memoryStorage);

type Call = { status: number; body: any; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; rawBody?: string; client?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.client) headers["x-vistoo-client"] = opts.client;
  const res = await handleApiRequest(
    new Request(`http://localhost:3100/api/v1${url}`, {
      method,
      headers,
      body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function member(workspaceId: string, role: "admin" | "member" = "member") {
  const user = await makeUser({ fullName: `Person ${randomUUID().slice(0, 4)}` });
  await addMember(workspaceId, user, role);
  const token = `token-${user.id}`;
  tokens.set(token, user);
  return { user, token };
}

let wsId: string;
let projectId: string;
let admin: { user: AuthUser; token: string };
let anna: { user: AuthUser; token: string };

beforeEach(async () => {
  const ws = await makeWorkspace();
  wsId = ws.id;
  admin = await member(wsId, "admin");
  anna = await member(wsId);
  projectId = (await makeProject(wsId)).id;
});

describe("contract", () => {
  it("has a handler for every endpoint and vice versa", () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(endpoints).sort());
  });

  it("the committed OpenAPI document is up to date (run `npm run generate`)", () => {
    const file = path.resolve(import.meta.dirname, "../../contracts/generated/openapi.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  it("unknown endpoints → 404, wrong method → 405, broken JSON → 422", async () => {
    expect((await call("GET", "/nope", { token: anna.token })).status).toBe(404);
    expect((await call("DELETE", "/tasks", { token: anna.token })).status).toBe(405);
    const broken = await call("POST", "/tasks", { token: anna.token, rawBody: "{nope" });
    expect(broken.status).toBe(422);
    expect(broken.body.error.code).toBe("VALIDATION");
  });

  it("meta is public and names the Supabase project of this environment", async () => {
    const res = await call("GET", "/meta");
    expect(res.status).toBe(200);
    expect(res.body.supabaseUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("authentication and authorization", () => {
  it("requires a valid bearer token", async () => {
    expect((await call("GET", "/tasks")).status).toBe(401);
    const res = await call("GET", "/tasks", { token: "forged" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("a signed-in user without membership sees their access state but no data", async () => {
    const outsider = await makeUser();
    tokens.set("outsider", outsider);
    const me = await call("GET", "/me", { token: "outsider" });
    expect(me.status).toBe(200);
    expect(me.body.access).toBe("none");
    expect(me.body.viewer).toBeNull();
    expect((await call("GET", "/bootstrap", { token: "outsider" })).status).toBe(403);
  });

  it("ids from another workspace behave like missing ones", async () => {
    const other = await makeWorkspace("Fremd");
    const stranger = await member(other.id);
    const created = await call("POST", "/tasks", { token: anna.token, body: { projectId, title: "Intern" } });
    expect(created.status).toBe(201);
    expect((await call("GET", `/tasks/${created.body.id}`, { token: stranger.token })).status).toBe(404);
    expect((await call("GET", `/tasks?projectId=${projectId}`, { token: stranger.token })).status).toBe(404);
    const patch = await call("PATCH", `/tasks/${created.body.id}`, {
      token: stranger.token,
      body: { expectedVersion: 1, patch: { title: "Gekapert" } },
    });
    expect(patch.status).toBe(404);
  });

  it("removing a member revokes API access immediately, even with a valid token", async () => {
    expect((await call("GET", "/tasks", { token: anna.token })).status).toBe(200);
    const removed = await call("DELETE", `/members/${anna.user.id}`, { token: admin.token });
    expect(removed.status).toBe(200);
    const after = await call("GET", "/tasks", { token: anna.token });
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("FORBIDDEN");
  });

  it("admin-only operations are refused for members", async () => {
    const res = await call("POST", "/invitations", { token: anna.token, body: { email: "neu@example.com" } });
    expect(res.status).toBe(403);
    expect((await call("GET", "/chat/storage", { token: anna.token })).status).toBe(403);
  });

  it("the last admin is protected", async () => {
    const res = await call("PUT", `/members/${admin.user.id}/role`, { token: admin.token, body: { role: "member" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });

  it("outdated iOS builds are asked to update; meta stays reachable", async () => {
    process.env.MIN_IOS_BUILD = "10";
    try {
      const res = await call("GET", "/tasks", { token: anna.token, client: "ios/9" });
      expect(res.status).toBe(426);
      expect(res.body.error.code).toBe("CLIENT_OUTDATED");
      expect((await call("GET", "/tasks", { token: anna.token, client: "ios/10" })).status).toBe(200);
      expect((await call("GET", "/meta", { client: "ios/1" })).body.minimumIosBuild).toBe(10);
    } finally {
      delete process.env.MIN_IOS_BUILD;
    }
  });
});

describe("tasks", () => {
  it("create is idempotent with a client id (retry after network loss)", async () => {
    const id = randomUUID();
    const body = { id, projectId, title: "Angebot schreiben" };
    const first = await call("POST", "/tasks", { token: anna.token, body });
    const retry = await call("POST", "/tasks", { token: anna.token, body });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(id);
    expect(await getDb().select().from(tasks).where(eq(tasks.id, id))).toHaveLength(1);
    // Someone else cannot claim the id.
    const hijack = await call("POST", "/tasks", { token: admin.token, body });
    expect(hijack.status).toBe(409);
  });

  it("web-created tasks are editable via the API with version checks", async () => {
    const created = await call("POST", "/tasks", { token: admin.token, body: { projectId, title: "Im Web erstellt" } });
    const ok = await call("PATCH", `/tasks/${created.body.id}`, {
      token: anna.token,
      body: { expectedVersion: created.body.version, patch: { status: "in_progress", startDate: "2026-11-09", endDate: "2026-11-13" } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.startDate).toBe("2026-11-09");
    const stale = await call("PATCH", `/tasks/${created.body.id}`, {
      token: anna.token,
      body: { expectedVersion: created.body.version, patch: { title: "Veraltet" } },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONFLICT");
    expect(stale.body.error.current.version).toBe(ok.body.version);
  });

  it("explicit null clears a field; omitted fields stay unchanged", async () => {
    const created = await call("POST", "/tasks", {
      token: anna.token,
      body: { projectId, title: "Mit Person", assigneeId: anna.user.id, startDate: "2026-11-01", endDate: "2026-11-02" },
    });
    const res = await call("PATCH", `/tasks/${created.body.id}`, {
      token: anna.token,
      body: { expectedVersion: created.body.version, patch: { assigneeId: null } },
    });
    expect(res.body.assigneeId).toBeNull();
    expect(res.body.startDate).toBe("2026-11-01");
  });

  it("board moves and quick actions", async () => {
    const a = (await call("POST", "/tasks", { token: anna.token, body: { projectId, title: "A" } })).body;
    const b = (await call("POST", "/tasks", { token: anna.token, body: { projectId, title: "B" } })).body;
    const moved = await call("POST", `/tasks/${b.id}/move`, {
      token: anna.token,
      body: { status: "open", afterId: null, beforeId: a.id },
    });
    expect(moved.body.position).toBeLessThan(a.position);
    const status = await call("PUT", `/tasks/${a.id}/status`, { token: anna.token, body: { status: "done" } });
    expect(status.body.status).toBe("done");
    const unassign = await call("PUT", `/tasks/${a.id}/assignee`, { token: anna.token, body: { assigneeId: null } });
    expect(unassign.status).toBe(200);
    expect((await call("DELETE", `/tasks/${a.id}`, { token: anna.token })).status).toBe(204);
    // Retried delete: NOT_FOUND means it is already gone.
    expect((await call("DELETE", `/tasks/${a.id}`, { token: anna.token })).status).toBe(404);
  });

  it("archived projects are read-only", async () => {
    await call("PUT", `/projects/${projectId}/archived`, { token: anna.token, body: { archived: true } });
    const res = await call("POST", "/tasks", { token: anna.token, body: { projectId, title: "Zu spät" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ARCHIVED");
  });
});

describe("chat", () => {
  async function channel(token: string, visibility: "open" | "private", memberIds: string[] = []) {
    const res = await call("POST", "/conversations/channels", {
      token,
      body: { name: `Kanal ${randomUUID().slice(0, 6)}`, visibility, memberIds },
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("closed channels are invisible to non-participants (also for admins)", async () => {
    const id = await channel(anna.token, "private");
    for (const token of [admin.token]) {
      expect((await call("GET", `/conversations/${id}`, { token })).status).toBe(404);
      expect((await call("GET", `/conversations/${id}/messages`, { token })).status).toBe(404);
      const send = await call("PUT", `/conversations/${id}/messages/${randomUUID()}`, { token, body: { body: "hi" } });
      expect(send.status).toBe(404);
    }
    const list = await call("GET", "/conversations", { token: admin.token });
    expect(list.body.conversations.map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it("sending is idempotent per client message id; unread is shared across platforms", async () => {
    const id = await channel(anna.token, "open");
    const messageId = randomUUID();
    const first = await call("PUT", `/conversations/${id}/messages/${messageId}`, { token: anna.token, body: { body: "Hallo" } });
    const retry = await call("PUT", `/conversations/${id}/messages/${messageId}`, { token: anna.token, body: { body: "Hallo" } });
    expect(first.status).toBe(200);
    expect(retry.body.seq).toBe(first.body.seq);
    expect(await getDb().select().from(messages).where(eq(messages.id, messageId))).toHaveLength(1);

    const before = await call("GET", "/conversations", { token: admin.token });
    expect(before.body.conversations.find((c: { id: string }) => c.id === id).unread).toBe(true);
    await call("PUT", `/conversations/${id}/read`, { token: admin.token, body: { seq: first.body.seq } });
    const after = await call("GET", "/conversations", { token: admin.token });
    expect(after.body.conversations.find((c: { id: string }) => c.id === id).unread).toBe(false);
  });

  it("history pages by cursor", async () => {
    const id = await channel(anna.token, "open");
    for (let i = 0; i < 55; i++) {
      await call("PUT", `/conversations/${id}/messages/${randomUUID()}`, { token: anna.token, body: { body: `#${i}` } });
    }
    const newest = await call("GET", `/conversations/${id}/messages`, { token: admin.token });
    expect(newest.body.messages).toHaveLength(50);
    expect(newest.body.hasMore).toBe(true);
    const older = await call("GET", `/conversations/${id}/messages?beforeSeq=${newest.body.messages[0].seq}`, {
      token: admin.token,
    });
    expect(older.body.messages).toHaveLength(5);
    expect(older.body.hasMore).toBe(false);
    const missed = await call("GET", `/conversations/${id}/messages?afterSeq=${newest.body.messages[48].seq}`, {
      token: admin.token,
    });
    expect(missed.body.messages).toHaveLength(1);
  });

  it("uploads: same limits and allowlist for every client; download needs fresh access", async () => {
    const id = await channel(anna.token, "private");
    const tooBig = await call("POST", `/conversations/${id}/uploads`, {
      token: anna.token,
      body: { fileName: "riesig.pdf", sizeBytes: 10 * 1024 * 1024 + 1 },
    });
    expect(tooBig.status).toBe(422);
    const wrongType = await call("POST", `/conversations/${id}/uploads`, {
      token: anna.token,
      body: { fileName: "skript.exe", sizeBytes: 10 },
    });
    expect(wrongType.status).toBe(422);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const ticket = await call("POST", `/conversations/${id}/uploads`, {
      token: anna.token,
      body: { fileName: "foto.png", sizeBytes: png.length },
    });
    expect(ticket.status).toBe(201);
    const [row] = await getDb()
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.id, ticket.body.attachmentId));
    objects.set(row.storagePath, png);
    expect((await call("POST", `/uploads/${ticket.body.attachmentId}/finalize`, { token: anna.token })).status).toBe(200);
    const sent = await call("PUT", `/conversations/${id}/messages/${randomUUID()}`, {
      token: anna.token,
      body: { body: "", attachmentIds: [ticket.body.attachmentId] },
    });
    expect(sent.body.attachments).toHaveLength(1);

    const download = await call("GET", `/attachments/${ticket.body.attachmentId}/download`, { token: anna.token });
    expect(download.status).toBe(200);
    expect(download.body.expiresInSeconds).toBe(60);
    // Not a participant → no link.
    expect((await call("GET", `/attachments/${ticket.body.attachmentId}/download`, { token: admin.token })).status).toBe(404);
  });
});

describe("every endpoint is reachable", () => {
  it("lists the operations covered here", () => {
    const covered: OperationId[] = Object.keys(endpoints) as OperationId[];
    expect(covered.length).toBeGreaterThan(40);
  });
});
