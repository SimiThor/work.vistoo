import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { CHAT_LIMITS, fileTypeForName, matchesSignature } from "@vistoo/domain/chat-config";
import type { ChatStorageUsage, UploadTicket } from "@vistoo/domain/chat-types";
import type { reserveUploadSchema } from "@vistoo/domain/validation";
import { assertAdmin, type AuthContext } from "../auth";
import { CHAT_BUCKET, supabaseChatStorage, type ChatStorage } from "../chat-storage";
import { getDb, type DbOrTx } from "../db";
import { messageAttachments, workspaces } from "@vistoo/database/schema";
import { AppError, invalid } from "../errors";
import { getAccessibleConversation } from "./chat";

/*
 * Upload flow (Storage and Postgres share no transaction):
 *   1. reserveUpload   – checks access + budget under a workspace lock, inserts
 *                        a "reserved" row (counts against the budget) and
 *                        returns a signed upload URL for a random path.
 *   2. browser PUTs the file directly to Supabase Storage (not via Vercel).
 *   3. finalizeUpload  – re-checks access, inspects the stored object (size,
 *                        signature) → "uploaded", or deletes it.
 *   4. sendMessage     – links "uploaded" rows to the message → "attached".
 *   5. cleanup         – expired reservations, unattached uploads, "deleting"
 *                        rows and orphaned objects are removed (retryable).
 */

const RESERVATION_TTL_MS = 15 * 60_000;
const UNATTACHED_TTL_MS = 24 * 60 * 60_000;
/** Signed upload URLs live 2 h; objects without a row older than that are orphans. */
const ORPHAN_GRACE_MS = 3 * 60 * 60_000;
/** Free plan: 1 GB storage per project. Override if the plan changes. */
const PROJECT_STORAGE_QUOTA_BYTES = Number(process.env.STORAGE_QUOTA_MB ?? 1024) * 1024 * 1024;
const PROJECT_SAFETY_MARGIN = 0.9;

let storage: ChatStorage = supabaseChatStorage;
/** Test hook. */
export function setChatStorageForTests(s: ChatStorage) {
  storage = s;
}

const ACTIVE_STATUSES = ["reserved", "uploaded", "attached", "deleting"] as const;

async function usedBytes(db: DbOrTx, workspaceId: string): Promise<number> {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${messageAttachments.sizeBytes}), 0)` })
    .from(messageAttachments)
    .where(
      and(eq(messageAttachments.workspaceId, workspaceId), inArray(messageAttachments.status, [...ACTIVE_STATUSES])),
    );
  return Number(r?.total ?? 0);
}

/** Storage used outside the chat bucket (other features/projects in this Supabase project). */
async function hasStorageSchema(db: DbOrTx): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`SELECT to_regclass('storage.objects') IS NOT NULL AS ok`);
  return Boolean(rows[0]?.ok);
}

async function otherStorageBytes(db: DbOrTx): Promise<number> {
  if (!(await hasStorageSchema(db))) return 0; // plain Postgres (tests)
  const rows = await db.execute<{ total: string | null }>(sql`
    SELECT coalesce(sum((metadata->>'size')::bigint), 0) AS total
      FROM storage.objects WHERE bucket_id <> ${CHAT_BUCKET}`);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Configured chat budget, lowered if the project's remaining storage quota
 * (minus a safety margin) is smaller. Never triggers paid upgrades.
 */
export async function effectiveBudgetBytes(db: DbOrTx): Promise<number> {
  const configured = Number(process.env.CHAT_STORAGE_BUDGET_MB ?? 0) * 1024 * 1024 || CHAT_LIMITS.workspaceBudgetBytes;
  const headroom = PROJECT_STORAGE_QUOTA_BYTES * PROJECT_SAFETY_MARGIN - (await otherStorageBytes(db));
  return Math.max(0, Math.min(configured, headroom));
}

export async function reserveUpload(
  ctx: AuthContext,
  input: z.output<typeof reserveUploadSchema>,
): Promise<UploadTicket> {
  const type = fileTypeForName(input.fileName);
  if (!type) throw invalid("Dieser Dateityp ist nicht erlaubt.");
  if (input.sizeBytes > CHAT_LIMITS.maxFileBytes) throw invalid("Die Datei ist größer als 10 MB.");

  // Free space first (bounded, best effort).
  await cleanupChatFiles({ workspaceId: ctx.workspaceId, limit: 20 }).catch(() => {});

  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.conversationId);
    if (conv.archivedAt) throw new AppError("ARCHIVED", "Dieser Kanal ist archiviert.");
    // Serialize budget checks per workspace: parallel uploads cannot overbook.
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).for("update");
    const [used, budget] = await Promise.all([usedBytes(tx, ctx.workspaceId), effectiveBudgetBytes(tx)]);
    if (used + input.sizeBytes > budget) {
      throw new AppError(
        "VALIDATION",
        "Der Speicher für Chat-Dateien ist ausgeschöpft. Nachrichten ohne Anhang sind weiterhin möglich.",
      );
    }
    const [inserted] = await tx
      .insert(messageAttachments)
      .values({
        workspaceId: ctx.workspaceId,
        conversationId: conv.id,
        uploaderId: ctx.userId,
        storagePath: `${ctx.workspaceId}/${conv.id}/${randomUUID()}`,
        fileName: input.fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_"),
        mimeType: type.mime,
        sizeBytes: input.sizeBytes,
        status: "reserved",
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      })
      .returning();
    return inserted;
  });

  try {
    const { signedUrl } = await storage.createUploadUrl(row.storagePath);
    return { attachmentId: row.id, signedUrl, contentType: row.mimeType };
  } catch (err) {
    await db.delete(messageAttachments).where(eq(messageAttachments.id, row.id));
    console.error("[chat] upload URL failed:", err instanceof Error ? err.message : String(err));
    throw new AppError("INTERNAL", "Der Upload konnte nicht vorbereitet werden.");
  }
}

async function loadOwnAttachment(ctx: AuthContext, id: string) {
  const [row] = await getDb()
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, id),
        eq(messageAttachments.workspaceId, ctx.workspaceId),
        eq(messageAttachments.uploaderId, ctx.userId),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "Datei nicht gefunden.");
  return row;
}

async function dropUpload(id: string, path: string) {
  await getDb()
    .update(messageAttachments)
    .set({ status: "deleting", updatedAt: new Date() })
    .where(eq(messageAttachments.id, id));
  await storage.remove([path]).catch(() => {});
  await getDb().delete(messageAttachments).where(eq(messageAttachments.id, id)).catch(() => {});
}

/** Verifies the stored object and makes it attachable. */
export async function finalizeUpload(ctx: AuthContext, id: string): Promise<{ id: string; sizeBytes: number }> {
  const row = await loadOwnAttachment(ctx, id);
  if (row.status === "uploaded") return { id: row.id, sizeBytes: row.sizeBytes };
  if (row.status !== "reserved") throw invalid("Dieser Upload ist nicht mehr gültig.");

  try {
    // Re-check: a member removed in the meantime must not publish the file.
    const conv = await getAccessibleConversation(getDb(), ctx, row.conversationId);
    if (conv.archivedAt) throw new AppError("ARCHIVED", "Dieser Kanal ist archiviert.");
  } catch (err) {
    await dropUpload(row.id, row.storagePath);
    throw err;
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await dropUpload(row.id, row.storagePath);
    throw invalid("Der Upload hat zu lange gedauert. Bitte versuche es erneut.");
  }

  const info = await storage.inspect(row.storagePath);
  if (!info) throw invalid("Die Datei wurde nicht vollständig hochgeladen. Bitte versuche es erneut.");
  const type = fileTypeForName(row.fileName);
  const problem = !type
    ? "Dieser Dateityp ist nicht erlaubt."
    : info.size > row.sizeBytes || info.size > CHAT_LIMITS.maxFileBytes
      ? "Die Datei ist größer als angegeben."
      : info.size === 0
        ? "Die Datei ist leer."
        : !matchesSignature(type.signature, info.head)
          ? "Der Dateiinhalt passt nicht zum Dateityp."
          : null;
  if (problem) {
    await dropUpload(row.id, row.storagePath);
    throw invalid(problem);
  }

  const [updated] = await getDb()
    .update(messageAttachments)
    .set({
      status: "uploaded",
      sizeBytes: info.size,
      expiresAt: new Date(Date.now() + UNATTACHED_TTL_MS),
      updatedAt: new Date(),
    })
    .where(and(eq(messageAttachments.id, row.id), eq(messageAttachments.status, "reserved")))
    .returning();
  if (!updated) throw invalid("Dieser Upload ist nicht mehr gültig.");
  return { id: updated.id, sizeBytes: updated.sizeBytes };
}

/** Removes a not-yet-sent upload (user removed it from the composer). */
export async function discardUpload(ctx: AuthContext, id: string): Promise<void> {
  const row = await loadOwnAttachment(ctx, id);
  if (row.status === "attached") throw invalid("Der Anhang gehört bereits zu einer Nachricht.");
  await dropUpload(row.id, row.storagePath);
}

/** Short-lived download link after a fresh access check (downloads as attachment). */
export async function getDownloadUrl(ctx: AuthContext, attachmentId: string): Promise<{ url: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.id, attachmentId),
        eq(messageAttachments.workspaceId, ctx.workspaceId),
        eq(messageAttachments.status, "attached"),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "Datei nicht gefunden.");
  await getAccessibleConversation(db, ctx, row.conversationId);
  return { url: await storage.createDownloadUrl(row.storagePath, row.fileName) };
}

/** Deletes files of rows in status "deleting" (optionally for one message). */
export async function deleteAttachmentFiles(scope: { messageId?: string; workspaceId?: string; limit?: number }) {
  const db = getDb();
  const rows = await db
    .select({ id: messageAttachments.id, path: messageAttachments.storagePath })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.status, "deleting"),
        scope.messageId ? eq(messageAttachments.messageId, scope.messageId) : undefined,
        scope.workspaceId ? eq(messageAttachments.workspaceId, scope.workspaceId) : undefined,
      ),
    )
    .limit(scope.limit ?? 100);
  if (rows.length === 0) return 0;
  await storage.remove(rows.map((r) => r.path)); // throws → rows stay "deleting" for retry
  await db.delete(messageAttachments).where(
    inArray(
      messageAttachments.id,
      rows.map((r) => r.id),
    ),
  );
  return rows.length;
}

/**
 * Housekeeping (idempotent, bounded):
 *  - expired reservations and unattached uploads → "deleting",
 *  - "deleting" rows → files removed, rows deleted,
 *  - objects in the bucket without any row (aborted uploads) → removed.
 */
export async function cleanupChatFiles(opts: { workspaceId?: string; limit?: number } = {}) {
  const db = getDb();
  const limit = opts.limit ?? 200;
  const now = new Date();
  await db
    .update(messageAttachments)
    .set({ status: "deleting", updatedAt: now })
    .where(
      and(
        opts.workspaceId ? eq(messageAttachments.workspaceId, opts.workspaceId) : undefined,
        or(eq(messageAttachments.status, "reserved"), eq(messageAttachments.status, "uploaded")),
        lt(messageAttachments.expiresAt, now),
      ),
    );
  const deleted = await deleteAttachmentFiles({ workspaceId: opts.workspaceId, limit });

  let orphans = 0;
  if (!opts.workspaceId && (await hasStorageSchema(db))) {
    const rows = await db.execute<{ name: string }>(sql`
      SELECT o.name FROM storage.objects o
       WHERE o.bucket_id = ${CHAT_BUCKET}
         AND o.created_at < ${new Date(Date.now() - ORPHAN_GRACE_MS)}
         AND NOT EXISTS (SELECT 1 FROM ${messageAttachments} a WHERE a.storage_path = o.name)
       LIMIT ${limit}`);
    if (rows.length) {
      await storage.remove(rows.map((r) => r.name));
      orphans = rows.length;
    }
  }
  return { deleted, orphans };
}

export async function getChatStorageUsage(ctx: AuthContext): Promise<ChatStorageUsage> {
  assertAdmin(ctx);
  const db = getDb();
  const [used, budget] = await Promise.all([usedBytes(db, ctx.workspaceId), effectiveBudgetBytes(db)]);
  return { usedBytes: used, budgetBytes: budget, ratio: budget > 0 ? used / budget : 1 };
}

