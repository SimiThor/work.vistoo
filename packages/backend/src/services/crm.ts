import "server-only";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  CONTACT_ACTIVITY_TYPES,
  isSystemActivity,
  type ActivityDTO,
  type ActivityMetadata,
  type AttractionDTO,
  type createActivitySchema,
  type createAttractionSchema,
  type SystemActivityType,
  type updateActivitySchema,
  type updateAttractionSchema,
} from "@vistoo/domain/crm";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import { attractionActivities, attractions, type Attraction, type AttractionActivity } from "@vistoo/database/schema";
import { AppError, forbidden, notFound } from "../errors";
import { assertActiveMember } from "./guards";

/**
 * CRM for potential partner attractions. Shared within the workspace.
 *
 * Timeline rules:
 *  - The service writes system entries ("created", status / owner / follow-up
 *    changes) in the SAME transaction as the change, while holding the row
 *    lock. Only real changes are logged, so a repeated or concurrent identical
 *    update produces exactly one entry. Text fields never create entries.
 *  - System entries are immutable (service + database trigger).
 *  - Manual entries (call, e-mail, meeting, note) can be edited or deleted by
 *    their author or an admin.
 */

export function toAttractionDTO(a: Attraction): AttractionDTO {
  return {
    id: a.id,
    name: a.name,
    city: a.city,
    country: a.country,
    website: a.website,
    email: a.email,
    contactName: a.contactName,
    status: a.status,
    ownerId: a.ownerId,
    notes: a.notes,
    nextFollowUp: a.nextFollowUp,
    lastContactAt: a.lastContactAt?.toISOString() ?? null,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toActivityDTO(a: AttractionActivity): ActivityDTO {
  return {
    id: a.id,
    attractionId: a.attractionId,
    type: a.type,
    system: isSystemActivity(a.type),
    description: a.description,
    metadata: a.metadata ?? {},
    actorId: a.actorId,
    occurredAt: a.occurredAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

async function findAttraction(db: DbOrTx, ctx: AuthContext, id: string, lock = false): Promise<Attraction> {
  const q = db
    .select()
    .from(attractions)
    .where(and(eq(attractions.id, id), eq(attractions.workspaceId, ctx.workspaceId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Attraktion");
  return row;
}

async function logSystem(
  tx: Tx,
  ctx: AuthContext,
  attractionId: string,
  type: SystemActivityType,
  metadata: ActivityMetadata = {},
) {
  await tx.insert(attractionActivities).values({
    workspaceId: ctx.workspaceId,
    attractionId,
    type,
    metadata,
    actorId: ctx.userId,
  });
}

/** Re-derives "Letzter Kontakt" from the contact activities (call / e-mail / meeting). */
async function refreshLastContact(tx: Tx, ctx: AuthContext, attractionId: string): Promise<Attraction> {
  const [r] = await tx
    .select({ last: max(attractionActivities.occurredAt) })
    .from(attractionActivities)
    .where(
      and(
        eq(attractionActivities.attractionId, attractionId),
        eq(attractionActivities.workspaceId, ctx.workspaceId),
        inArray(attractionActivities.type, [...CONTACT_ACTIVITY_TYPES]),
      ),
    );
  const [row] = await tx
    .update(attractions)
    .set({ lastContactAt: r?.last ?? null })
    .where(and(eq(attractions.id, attractionId), eq(attractions.workspaceId, ctx.workspaceId)))
    .returning();
  return row;
}

/** Applies status / owner / follow-up changes and logs exactly the ones that really changed. */
async function applyTrackedChanges(
  tx: Tx,
  ctx: AuthContext,
  current: Attraction,
  next: Pick<Attraction, "status" | "ownerId" | "nextFollowUp">,
) {
  if (next.ownerId && next.ownerId !== current.ownerId) await assertActiveMember(tx, ctx, next.ownerId);
  if (next.status !== current.status) {
    await logSystem(tx, ctx, current.id, "status_changed", { from: current.status, to: next.status });
  }
  if (next.ownerId !== current.ownerId) {
    await logSystem(tx, ctx, current.id, "owner_changed", { from: current.ownerId, to: next.ownerId });
  }
  if (next.nextFollowUp !== current.nextFollowUp) {
    await logSystem(tx, ctx, current.id, "follow_up_changed", { from: current.nextFollowUp, to: next.nextFollowUp });
  }
}

// ---------------------------------------------------------------------------
// Attractions
// ---------------------------------------------------------------------------

export async function listAttractions(ctx: AuthContext): Promise<AttractionDTO[]> {
  const rows = await getDb()
    .select()
    .from(attractions)
    .where(eq(attractions.workspaceId, ctx.workspaceId))
    .orderBy(asc(sql`lower(${attractions.name})`), asc(attractions.id));
  return rows.map(toAttractionDTO);
}

/** Timeline: newest first (by occurrence, then by recording order). */
export async function listActivities(ctx: AuthContext, attractionId: string): Promise<ActivityDTO[]> {
  const db = getDb();
  await findAttraction(db, ctx, attractionId);
  const rows = await db
    .select()
    .from(attractionActivities)
    .where(
      and(eq(attractionActivities.attractionId, attractionId), eq(attractionActivities.workspaceId, ctx.workspaceId)),
    )
    .orderBy(desc(attractionActivities.occurredAt), desc(attractionActivities.createdAt), desc(attractionActivities.id));
  return rows.map(toActivityDTO);
}

export async function createAttraction(
  ctx: AuthContext,
  input: z.output<typeof createAttractionSchema>,
): Promise<AttractionDTO> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(attractions).where(eq(attractions.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
          throw new AppError("CONFLICT", "Diese Attraktion konnte nicht angelegt werden.");
        }
        return toAttractionDTO(existing);
      }
    }
    if (input.ownerId) await assertActiveMember(tx, ctx, input.ownerId);
    const [row] = await tx
      .insert(attractions)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        name: input.name,
        city: input.city,
        country: input.country,
        website: input.website,
        email: input.email,
        contactName: input.contactName,
        status: input.status,
        ownerId: input.ownerId,
        notes: input.notes,
        nextFollowUp: input.nextFollowUp,
        createdBy: ctx.userId,
      })
      .returning();
    await logSystem(tx, ctx, row.id, "created");
    return toAttractionDTO(row);
  });
}

/** Partial update (table: status only; panel: changed fields only). */
export async function updateAttraction(
  ctx: AuthContext,
  input: z.output<typeof updateAttractionSchema>,
): Promise<AttractionDTO> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await findAttraction(tx, ctx, id, true);
    const tracked = {
      status: patch.status ?? current.status,
      ownerId: patch.ownerId !== undefined ? patch.ownerId : current.ownerId,
      nextFollowUp: patch.nextFollowUp !== undefined ? patch.nextFollowUp : current.nextFollowUp,
    };
    await applyTrackedChanges(tx, ctx, current, tracked);
    const pick = <K extends keyof typeof patch>(k: K, fallback: Attraction[K & keyof Attraction]) =>
      patch[k] !== undefined ? patch[k] : fallback;
    const [row] = await tx
      .update(attractions)
      .set({
        ...tracked,
        name: patch.name ?? current.name,
        city: pick("city", current.city),
        country: pick("country", current.country),
        website: pick("website", current.website),
        email: pick("email", current.email),
        contactName: pick("contactName", current.contactName),
        notes: patch.notes ?? current.notes,
        updatedAt: new Date(),
      })
      .where(and(eq(attractions.id, id), eq(attractions.workspaceId, ctx.workspaceId)))
      .returning();
    return toAttractionDTO(row);
  });
}

/** Deletes the attraction with its whole timeline. */
export async function deleteAttraction(ctx: AuthContext, id: string): Promise<{ id: string }> {
  const deleted = await getDb()
    .delete(attractions)
    .where(and(eq(attractions.id, id), eq(attractions.workspaceId, ctx.workspaceId)))
    .returning({ id: attractions.id });
  if (deleted.length === 0) throw notFound("Attraktion");
  return { id };
}

// ---------------------------------------------------------------------------
// Manual activities
// ---------------------------------------------------------------------------

async function findManualActivity(tx: Tx, ctx: AuthContext, id: string): Promise<AttractionActivity> {
  const [row] = await tx
    .select()
    .from(attractionActivities)
    .where(and(eq(attractionActivities.id, id), eq(attractionActivities.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Aktivität");
  if (isSystemActivity(row.type)) throw forbidden("Automatische Einträge können nicht geändert werden.");
  if (row.actorId !== ctx.userId && ctx.role !== "admin") {
    throw forbidden("Nur die Person, die den Eintrag erstellt hat, oder ein Admin kann ihn ändern.");
  }
  return row;
}

/**
 * Records a call, e-mail, meeting or note. With `nextFollowUp` it also moves
 * the attraction's follow-up (logged as a system entry if it changed).
 */
export async function addActivity(
  ctx: AuthContext,
  input: z.output<typeof createActivitySchema>,
): Promise<{ attraction: AttractionDTO; activity: ActivityDTO }> {
  return getDb().transaction(async (tx) => {
    const current = await findAttraction(tx, ctx, input.attractionId, true);
    if (input.id) {
      const [existing] = await tx.select().from(attractionActivities).where(eq(attractionActivities.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.actorId !== ctx.userId) {
          throw new AppError("CONFLICT", "Diese Aktivität konnte nicht gespeichert werden.");
        }
        return { attraction: toAttractionDTO(current), activity: toActivityDTO(existing) };
      }
    }
    const [activity] = await tx
      .insert(attractionActivities)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        attractionId: current.id,
        type: input.type,
        description: input.description,
        actorId: ctx.userId,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      })
      .returning();
    if (input.nextFollowUp !== undefined && input.nextFollowUp !== current.nextFollowUp) {
      await applyTrackedChanges(tx, ctx, current, { ...current, nextFollowUp: input.nextFollowUp });
      await tx
        .update(attractions)
        .set({ nextFollowUp: input.nextFollowUp, updatedAt: new Date() })
        .where(and(eq(attractions.id, current.id), eq(attractions.workspaceId, ctx.workspaceId)));
    }
    const attraction = await refreshLastContact(tx, ctx, current.id);
    return { attraction: toAttractionDTO(attraction), activity: toActivityDTO(activity) };
  });
}

export async function updateActivity(
  ctx: AuthContext,
  input: z.output<typeof updateActivitySchema>,
): Promise<{ attraction: AttractionDTO; activity: ActivityDTO }> {
  const { id, patch } = input;
  return getDb().transaction(async (tx) => {
    const current = await findManualActivity(tx, ctx, id);
    await findAttraction(tx, ctx, current.attractionId, true);
    const [activity] = await tx
      .update(attractionActivities)
      .set({
        type: patch.type ?? current.type,
        description: patch.description ?? current.description,
        occurredAt: patch.occurredAt ? new Date(patch.occurredAt) : current.occurredAt,
        updatedAt: new Date(),
      })
      .where(and(eq(attractionActivities.id, id), eq(attractionActivities.workspaceId, ctx.workspaceId)))
      .returning();
    const attraction = await refreshLastContact(tx, ctx, current.attractionId);
    return { attraction: toAttractionDTO(attraction), activity: toActivityDTO(activity) };
  });
}

export async function deleteActivity(ctx: AuthContext, id: string): Promise<{ attraction: AttractionDTO }> {
  return getDb().transaction(async (tx) => {
    const current = await findManualActivity(tx, ctx, id);
    await findAttraction(tx, ctx, current.attractionId, true);
    await tx
      .delete(attractionActivities)
      .where(and(eq(attractionActivities.id, id), eq(attractionActivities.workspaceId, ctx.workspaceId)));
    const attraction = await refreshLastContact(tx, ctx, current.attractionId);
    return { attraction: toAttractionDTO(attraction) };
  });
}
