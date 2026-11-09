import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import { createIdeaSchema, createIssueFromIdeaSchema, updateIdeaSchema } from "@vistoo/domain/ideas";
import { createIdea, createIssueFromIdea, deleteIdea, listIdeas, updateIdea } from "../src/services/ideas";
import { setProjectArchived } from "../src/services/projects";
import { deleteTask, getTask, listTasks } from "../src/services/tasks";
import { addMember, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let wsId: string;
let anna: AuthContext;
let max: AuthContext;
let projectId: string;

const add = (c: AuthContext, input: Record<string, unknown>) => createIdea(c, createIdeaSchema.parse(input));
const patch = (c: AuthContext, id: string, p: Record<string, unknown>) => updateIdea(c, updateIdeaSchema.parse({ id, patch: p }));

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  anna = (await makeMemberCtx(wsId)).ctx;
  max = (await makeMemberCtx(wsId)).ctx;
  projectId = (await makeProject(wsId)).id;
});

describe("ideas", () => {
  it("are shared: everyone adds, edits, assigns and deletes; newest first", async () => {
    const a = await add(anna, { title: "Offline-Navigation verbessern" });
    const b = await add(max, { title: "Neue Challenge für die Festung", description: "Rätsel am Turm" });
    expect(a).toMatchObject({ status: "new", createdBy: anna.userId, assigneeId: null, task: null });
    expect((await listIdeas(anna)).map((i) => i.id)).toEqual([b.id, a.id]);

    const edited = await patch(anna, b.id, { status: "planned", assigneeId: anna.userId });
    expect(edited).toMatchObject({ status: "planned", assigneeId: anna.userId, description: "Rätsel am Turm" });
    // Partial updates keep fields someone else changed meanwhile.
    await patch(max, b.id, { title: "Neue Challenge: Festung" });
    expect((await listIdeas(anna)).find((i) => i.id === b.id)).toMatchObject({
      title: "Neue Challenge: Festung",
      status: "planned",
    });

    await deleteIdea(max, a.id);
    expect((await listIdeas(anna)).map((i) => i.id)).toEqual([b.id]);
  });

  it("assignee must be an active member", async () => {
    const removed = await makeUser();
    await addMember(wsId, removed, "member", "removed");
    await expect(add(anna, { title: "x", assigneeId: removed.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("ideas of another workspace behave like missing ones", async () => {
    const idea = await add(anna, { title: "Monetarisierung prüfen" });
    const other = (await makeMemberCtx((await makeWorkspace("Andere")).id)).ctx;
    expect(await listIdeas(other)).toEqual([]);
    await expect(patch(other, idea.id, { status: "irrelevant" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteIdea(other, idea.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create issue: a regular task with title and description, linked back; repeating returns the same issue", async () => {
    const idea = await add(anna, { id: randomUUID(), title: "KI-Assistent erweitern", description: "Mehr Sprachen" });
    const { idea: linked, task } = await createIssueFromIdea(anna, createIssueFromIdeaSchema.parse({ ideaId: idea.id, projectId }));
    expect(task).toMatchObject({ projectId, title: "KI-Assistent erweitern", description: "Mehr Sprachen", status: "open" });
    expect(linked.task).toEqual({ id: task.id, number: task.number, title: task.title, projectId });
    expect((await listTasks(anna)).map((t) => t.id)).toContain(task.id);

    const again = await createIssueFromIdea(max, createIssueFromIdeaSchema.parse({ ideaId: idea.id, projectId }));
    expect(again.task.id).toBe(task.id);
    expect(await listTasks(anna)).toHaveLength(1);

    // Deleting the issue unlinks the idea; a new issue can be created.
    await deleteTask(anna, task.id);
    expect((await listIdeas(anna))[0].task).toBeNull();
    const second = await createIssueFromIdea(anna, createIssueFromIdeaSchema.parse({ ideaId: idea.id, projectId }));
    expect((await getTask(anna, second.task.id)).title).toBe("KI-Assistent erweitern");
  });

  it("create issue respects the project rules (archived, foreign)", async () => {
    const idea = await add(anna, { title: "x" });
    await setProjectArchived(anna, { id: projectId, archived: true });
    await expect(
      createIssueFromIdea(anna, createIssueFromIdeaSchema.parse({ ideaId: idea.id, projectId })),
    ).rejects.toMatchObject({ code: "ARCHIVED" });
    const foreignProject = (await makeProject((await makeWorkspace("Fremd")).id)).id;
    await expect(
      createIssueFromIdea(anna, createIssueFromIdeaSchema.parse({ ideaId: idea.id, projectId: foreignProject })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listIdeas(anna))[0].task).toBeNull();
  });
});

describe("ideas: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("active members can read, others cannot; nobody writes through the Data API", async () => {
    await add(anna, { title: "Sichtbar im Team" });
    const stranger = await makeUser();
    const q = (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select id from ideas where workspace_id = ${wsId}`;
    expect(await asUser(max.userId, q)).toHaveLength(1);
    expect(await asUser(stranger.id, q)).toHaveLength(0);
    await expect(asUser(anna.userId, (tx) => tx`delete from ideas where workspace_id = ${wsId}`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
