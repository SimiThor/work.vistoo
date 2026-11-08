import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import { createTodoSchema, reorderTodosSchema, updateTodoSchema } from "@vistoo/domain/todos";
import { createTodo, deleteTodo, listTodos, reorderTodos, updateTodo } from "../src/services/todos";
import { addMember, makeMemberCtx, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let wsId: string;
let me: AuthContext;
let colleague: AuthContext;
let admin: AuthContext;

const add = (c: AuthContext, input: Record<string, unknown>) => createTodo(c, createTodoSchema.parse(input));
const patch = (c: AuthContext, id: string, p: Record<string, unknown>) => updateTodo(c, updateTodoSchema.parse({ id, patch: p }));

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  me = (await makeMemberCtx(wsId)).ctx;
  colleague = (await makeMemberCtx(wsId)).ctx;
  admin = (await makeMemberCtx(wsId, "admin")).ctx;
});

describe("personal to-dos", () => {
  it("add, edit, complete, reopen and delete; new ones go to the top", async () => {
    const a = await add(me, { title: "Domain verlängern" });
    const b = await add(me, { title: "  Rechnung kontrollieren ", dueDate: "2026-11-20", description: "Telekom" });
    expect(b).toMatchObject({ title: "Rechnung kontrollieren", dueDate: "2026-11-20", completed: false });
    expect((await listTodos(me)).map((t) => t.id)).toEqual([b.id, a.id]);

    const done = await patch(me, a.id, { completed: true });
    expect(done.completed).toBe(true);
    expect(done.completedAt).not.toBeNull();
    // Completed ones come after the open ones.
    expect((await listTodos(me)).map((t) => t.id)).toEqual([b.id, a.id]);
    expect((await patch(me, a.id, { completed: false })).completedAt).toBeNull();

    const edited = await patch(me, b.id, { title: "Rechnung prüfen", dueDate: null });
    expect(edited).toMatchObject({ title: "Rechnung prüfen", dueDate: null, description: "Telekom" });

    await deleteTodo(me, a.id);
    expect((await listTodos(me)).map((t) => t.id)).toEqual([b.id]);
  });

  it("are private: nobody else — not even an admin — can see or change them", async () => {
    const mine = await add(me, { title: "Florian wegen Vertrag kontaktieren" });
    for (const other of [colleague, admin]) {
      expect(await listTodos(other)).toEqual([]);
      await expect(patch(other, mine.id, { completed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(deleteTodo(other, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(reorderTodos(other, reorderTodosSchema.parse({ ids: [mine.id] }))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      // Reusing my id as client id does not leak or overwrite it.
      await expect(add(other, { id: mine.id, title: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect((await listTodos(me))[0]).toMatchObject({ id: mine.id, completed: false });
  });

  it("reorders open to-dos", async () => {
    const a = await add(me, { title: "A" });
    const b = await add(me, { title: "B" });
    const c = await add(me, { title: "C" });
    expect((await listTodos(me)).map((t) => t.title)).toEqual(["C", "B", "A"]);
    await reorderTodos(me, reorderTodosSchema.parse({ ids: [a.id, c.id, b.id] }));
    expect((await listTodos(me)).map((t) => t.title)).toEqual(["A", "C", "B"]);
  });

  it("create is idempotent with a client id; title is required", async () => {
    const id = randomUUID();
    await add(me, { id, title: "Präsentation überarbeiten" });
    await add(me, { id, title: "Präsentation überarbeiten" });
    expect(await listTodos(me)).toHaveLength(1);
    expect(createTodoSchema.safeParse({ title: "   " }).success).toBe(false);
  });
});

describe("personal to-dos: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("only the owner can read them through the Data API; nobody can write", async () => {
    await add(me, { title: "Privat" });
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    const q = (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select id from personal_todos where workspace_id = ${wsId}`;
    expect(await asUser(me.userId, q)).toHaveLength(1);
    expect(await asUser(colleague.userId, q)).toHaveLength(0);
    expect(await asUser(admin.userId, q)).toHaveLength(0);
    expect(await asUser(removed.id, q)).toHaveLength(0);
    await expect(asUser(null, q)).rejects.toThrow(/permission denied/);
    await expect(
      asUser(me.userId, (tx) => tx`update personal_todos set title = 'x' where workspace_id = ${wsId}`),
    ).rejects.toThrow(/permission denied/);
  });
});
