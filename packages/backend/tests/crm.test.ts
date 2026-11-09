import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth";
import { getDb } from "../src/db";
import { attractionActivities, attractions } from "@vistoo/database/schema";
import {
  createActivitySchema,
  createAttractionSchema,
  updateActivitySchema,
  updateAttractionSchema,
} from "@vistoo/domain/crm";
import {
  addActivity,
  createAttraction,
  deleteActivity,
  deleteAttraction,
  listActivities,
  listAttractions,
  updateActivity,
  updateAttraction,
} from "../src/services/crm";
import { makeMemberCtx, makeUser, makeWorkspace } from "./support/fixtures";
import { rlsClient } from "./support/rls";

let wsId: string;
let simon: AuthContext;
let felix: AuthContext;

const create = (c: AuthContext, input: Record<string, unknown>) => createAttraction(c, createAttractionSchema.parse(input));
const patch = (c: AuthContext, id: string, p: Record<string, unknown>) =>
  updateAttraction(c, updateAttractionSchema.parse({ id, patch: p }));
const log = (c: AuthContext, input: Record<string, unknown>) => addActivity(c, createActivitySchema.parse(input));
const types = async (c: AuthContext, id: string) => (await listActivities(c, id)).map((a) => a.type);

beforeEach(async () => {
  wsId = (await makeWorkspace()).id;
  simon = (await makeMemberCtx(wsId)).ctx;
  felix = (await makeMemberCtx(wsId)).ctx;
});

describe("attractions", () => {
  it("only the name is required; defaults to status new; optional fields are validated", async () => {
    const a = await create(simon, { name: "Festung Hohensalzburg" });
    expect(a).toMatchObject({ status: "new", city: null, website: null, email: null, ownerId: null, notes: "" });
    const b = await create(simon, {
      name: "Burg Kreuzenstein",
      city: "Leobendorf",
      country: "",
      website: "burg-kreuzenstein.at",
      email: " INFO@Burg.at ",
      contactName: "Frau Wilczek",
      ownerId: felix.userId,
      nextFollowUp: "2026-11-18",
    });
    expect(b).toMatchObject({
      country: null,
      website: "https://burg-kreuzenstein.at/",
      email: "info@burg.at",
      ownerId: felix.userId,
      nextFollowUp: "2026-11-18",
    });
    expect(createAttractionSchema.safeParse({ name: "x", website: "javascript:alert(1)" }).success).toBe(false);
    expect(createAttractionSchema.safeParse({ name: "x", email: "kein-mail" }).success).toBe(false);
    expect(createAttractionSchema.safeParse({ name: " " }).success).toBe(false);
    expect((await listAttractions(felix)).map((x) => x.name)).toEqual(["Burg Kreuzenstein", "Festung Hohensalzburg"]);
  });

  it("logs creation and exactly one entry per real status / owner / follow-up change", async () => {
    const a = await create(simon, { name: "Schloss Hellbrunn" });
    expect(await types(simon, a.id)).toEqual(["created"]);

    await patch(simon, a.id, { status: "contacted" });
    await patch(simon, a.id, { status: "contacted" }); // repeated: no new entry
    await patch(felix, a.id, { status: "interested", notes: "Mag die App", city: "Salzburg" }); // text: no entry
    await patch(simon, a.id, { ownerId: felix.userId });
    await patch(simon, a.id, { nextFollowUp: "2026-11-18" });
    await patch(simon, a.id, { nextFollowUp: "2026-11-18", name: "Schloss Hellbrunn & Wasserspiele" });
    await patch(simon, a.id, { nextFollowUp: null });

    const timeline = await listActivities(simon, a.id);
    expect(timeline.map((t) => t.type).sort()).toEqual(
      ["created", "status_changed", "status_changed", "owner_changed", "follow_up_changed", "follow_up_changed"].sort(),
    );
    const statuses = timeline.filter((t) => t.type === "status_changed").map((t) => t.metadata);
    expect(statuses).toContainEqual({ from: "new", to: "contacted" });
    expect(statuses).toContainEqual({ from: "contacted", to: "interested" });
    expect(timeline.find((t) => t.type === "status_changed" && t.metadata.to === "interested")?.actorId).toBe(felix.userId);
    expect(timeline.find((t) => t.type === "owner_changed")?.metadata).toEqual({ from: null, to: felix.userId });
    expect(timeline.filter((t) => t.type === "follow_up_changed").map((t) => t.metadata)).toContainEqual({
      from: "2026-11-18",
      to: null,
    });
    expect(timeline.every((t) => t.system)).toBe(true);
  });

  it("concurrent identical status changes produce exactly one entry", async () => {
    const a = await create(simon, { name: "Eisriesenwelt" });
    await Promise.all([patch(simon, a.id, { status: "partner" }), patch(felix, a.id, { status: "partner" })]);
    expect((await types(simon, a.id)).filter((t) => t === "status_changed")).toHaveLength(1);
  });

  it("a failed change writes neither the change nor a timeline entry", async () => {
    const a = await create(simon, { name: "Krimmler Wasserfälle" });
    const removed = await makeUser();
    await expect(patch(simon, a.id, { status: "partner", ownerId: removed.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await listAttractions(simon))[0].status).toBe("new");
    expect(await types(simon, a.id)).toEqual(["created"]);
  });

  it("delete removes the attraction with its timeline; foreign workspaces see nothing", async () => {
    const a = await create(simon, { id: randomUUID(), name: "Haus der Natur" });
    const outsider = (await makeMemberCtx((await makeWorkspace("Andere")).id)).ctx;
    expect(await listAttractions(outsider)).toEqual([]);
    await expect(patch(outsider, a.id, { status: "partner" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listActivities(outsider, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteAttraction(outsider, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await deleteAttraction(felix, a.id);
    expect(await listAttractions(simon)).toEqual([]);
    expect(await getDb().select().from(attractionActivities).where(eq(attractionActivities.attractionId, a.id))).toEqual([]);
  });
});

describe("manual activities", () => {
  it("appear newest first next to system entries; contact types set 'last contact'; follow-up moves along", async () => {
    const a = await create(simon, { name: "Festung", nextFollowUp: "2026-11-10" });
    const note = await log(simon, { attractionId: a.id, type: "note", description: "Website geprüft" });
    expect(note.attraction.lastContactAt).toBeNull(); // notes are not contact

    const call = await log(felix, {
      attractionId: a.id,
      type: "call",
      description: "Mit Frau Huber telefoniert",
      occurredAt: "2026-11-08T09:30:00+01:00",
      nextFollowUp: "2026-11-18",
    });
    expect(call.activity).toMatchObject({ type: "call", system: false, actorId: felix.userId });
    expect(call.activity.occurredAt).toBe("2026-11-08T08:30:00.000Z");
    expect(call.attraction).toMatchObject({ nextFollowUp: "2026-11-18", lastContactAt: "2026-11-08T08:30:00.000Z" });

    const timeline = await listActivities(simon, a.id);
    expect(timeline[0].type).not.toBe("call"); // the call happened earlier than the note was recorded
    expect(timeline.map((t) => t.type)).toEqual(expect.arrayContaining(["note", "call", "follow_up_changed", "created"]));
    expect(timeline.find((t) => t.type === "follow_up_changed")?.metadata).toEqual({ from: "2026-11-10", to: "2026-11-18" });

    // Same follow-up again: no extra system entry.
    await log(simon, { attractionId: a.id, type: "email", nextFollowUp: "2026-11-18" });
    expect((await types(simon, a.id)).filter((t) => t === "follow_up_changed")).toHaveLength(1);
  });

  it("is idempotent with a client id", async () => {
    const a = await create(simon, { name: "Festung" });
    const id = randomUUID();
    await log(simon, { id, attractionId: a.id, type: "meeting", description: "Termin vor Ort" });
    await log(simon, { id, attractionId: a.id, type: "meeting", description: "Termin vor Ort" });
    expect((await types(simon, a.id)).filter((t) => t === "meeting")).toHaveLength(1);
  });

  it("author or admin can edit and delete; 'last contact' follows", async () => {
    const a = await create(simon, { name: "Festung" });
    const { activity } = await log(simon, { attractionId: a.id, type: "call", occurredAt: "2026-11-01T10:00:00Z" });
    await expect(
      updateActivity(felix, updateActivitySchema.parse({ id: activity.id, patch: { description: "x" } })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const edited = await updateActivity(
      simon,
      updateActivitySchema.parse({ id: activity.id, patch: { type: "meeting", occurredAt: "2026-11-05T10:00:00Z" } }),
    );
    expect(edited.activity.type).toBe("meeting");
    expect(edited.attraction.lastContactAt).toBe("2026-11-05T10:00:00.000Z");

    const admin = (await makeMemberCtx(wsId, "admin")).ctx;
    const after = await deleteActivity(admin, activity.id);
    expect(after.attraction.lastContactAt).toBeNull();
  });

  it("automatic entries cannot be edited or deleted — neither via the service nor directly in the database", async () => {
    const a = await create(simon, { name: "Festung" });
    const [created] = await listActivities(simon, a.id);
    const admin = (await makeMemberCtx(wsId, "admin")).ctx;
    await expect(deleteActivity(admin, created.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateActivity(simon, updateActivitySchema.parse({ id: created.id, patch: { description: "x" } })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getDb().update(attractionActivities).set({ description: "x" }).where(eq(attractionActivities.id, created.id)),
    ).rejects.toThrow();
    await expect(getDb().delete(attractionActivities).where(eq(attractionActivities.id, created.id))).rejects.toThrow();
    // …but they go away together with their attraction.
    await getDb().delete(attractions).where(and(eq(attractions.id, a.id), eq(attractions.workspaceId, wsId)));
  });
});

describe("crm: row level security", () => {
  const { asUser, end } = rlsClient();
  afterAll(end);

  it("active members read attractions and timeline; strangers and anon do not; no writes", async () => {
    const a = await create(simon, { name: "Festung" });
    const stranger = await makeUser();
    expect(await asUser(felix.userId, (tx) => tx`select id from attractions where workspace_id = ${wsId}`)).toHaveLength(1);
    expect(await asUser(felix.userId, (tx) => tx`select id from attraction_activities where attraction_id = ${a.id}`)).toHaveLength(1);
    expect(await asUser(stranger.id, (tx) => tx`select id from attractions where workspace_id = ${wsId}`)).toHaveLength(0);
    expect(await asUser(stranger.id, (tx) => tx`select id from attraction_activities`)).toHaveLength(0);
    await expect(asUser(null, (tx) => tx`select id from attractions`)).rejects.toThrow(/permission denied/);
    await expect(
      asUser(felix.userId, (tx) => tx`update attractions set status = 'partner' where id = ${a.id}`),
    ).rejects.toThrow(/permission denied/);
  });
});
