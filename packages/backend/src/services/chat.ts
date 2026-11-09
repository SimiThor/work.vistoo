import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { CHAT_LIMITS } from "@vistoo/domain/chat-config";
import type {
  AttachmentDTO,
  ChatPerson,
  ConversationDetail,
  ConversationSummary,
  MessageDTO,
} from "@vistoo/domain/chat-types";
import { displayName } from "@vistoo/domain";
import { extractMentionIds, mentionsAll, renderMentionsPlain } from "@vistoo/domain/mentions";
import { extractIssueRefIds, renderIssueRefsPlain } from "@vistoo/domain/issue-refs";
import type { IssueRefDTO } from "@vistoo/domain/dto";
import type {
  archiveChannelSchema,
  channelMembersSchema,
  createChannelSchema,
  editMessageSchema,
  listMessagesSchema,
  markReadSchema,
  removeChannelMemberSchema,
  sendMessageSchema,
  updateChannelSchema,
} from "@vistoo/domain/validation";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";
import {
  conversationMembers,
  conversationReadStates,
  conversations,
  messageAttachments,
  messages,
  profiles,
  workspaceMembers,
  type Conversation,
  type Message,
} from "@vistoo/database/schema";
import { AppError, invalid } from "../errors";
import { deleteAttachmentFiles } from "./chat-files";
import { deleteMessageNotifications, markConversationNotificationsRead, syncMentionNotifications } from "./inbox";
import { notifyNewMessage } from "./notifications";
import { assertReferenceable, resolveIssueRefs } from "./issue-refs";

/*
 * Authorization rules (also mirrored by RLS for Realtime):
 *   - caller must be an active workspace member (AuthContext guarantees it),
 *   - open channels: everyone in the workspace,
 *   - private channels & DMs: explicit conversation_members row,
 *   - admins get no implicit access to private conversations.
 * Inaccessible conversations behave exactly like missing ones (no leaks).
 */

const notFound = () => new AppError("NOT_FOUND", "Diese Unterhaltung gibt es nicht oder du hast keinen Zugriff.");

export const DEFAULT_CHANNEL = {
  name: "Allgemein",
  description: "Für alle Themen, die das ganze Team betreffen.",
};

/** Idempotently ensures the open default channel exists for the workspace. */
export async function ensureDefaultChannel(db: DbOrTx, workspaceId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${conversations} (workspace_id, kind, name, description, is_default)
    VALUES (${workspaceId}, 'open_channel', ${DEFAULT_CHANNEL.name}, ${DEFAULT_CHANNEL.description}, true)
    ON CONFLICT (workspace_id) WHERE is_default DO NOTHING`);
}

async function isParticipant(db: DbOrTx, conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  return Boolean(row);
}

/** Loads a conversation the caller may access, optionally locking it. */
export async function getAccessibleConversation(
  db: DbOrTx,
  ctx: AuthContext,
  conversationId: string,
  opts: { lock?: boolean } = {},
): Promise<Conversation> {
  const q = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
  const [conv] = opts.lock ? await q.for("update") : await q;
  if (!conv) throw notFound();
  if (conv.kind !== "open_channel" && !(await isParticipant(db, conv.id, ctx.userId))) throw notFound();
  return conv;
}

async function dmPartnerOf(db: DbOrTx, conv: Conversation, ctx: AuthContext): Promise<ChatPerson | null> {
  if (conv.kind !== "dm") return null;
  const [row] = await db
    .select({
      userId: profiles.id,
      fullName: profiles.fullName,
      email: profiles.email,
      status: workspaceMembers.status,
    })
    .from(conversationMembers)
    .innerJoin(profiles, eq(profiles.id, conversationMembers.userId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.userId, conversationMembers.userId), eq(workspaceMembers.workspaceId, ctx.workspaceId)),
    )
    .where(and(eq(conversationMembers.conversationId, conv.id), sql`${conversationMembers.userId} <> ${ctx.userId}`));
  return row ? { userId: row.userId, fullName: row.fullName, email: row.email, active: row.status === "active" } : null;
}

/** Whether new messages may be posted (archived channels / inactive DM partner are read-only). */
async function postability(db: DbOrTx, conv: Conversation, ctx: AuthContext) {
  if (conv.archivedAt) return { canPost: false, reason: "archived" as const };
  if (conv.kind === "dm") {
    const partner = await dmPartnerOf(db, conv, ctx);
    if (!partner?.active) return { canPost: false, reason: "inactive_partner" as const };
  }
  return { canPost: true, reason: null };
}

function assertWritable(p: { canPost: boolean; reason: "archived" | "inactive_partner" | null }) {
  if (p.canPost) return;
  throw new AppError(
    "ARCHIVED",
    p.reason === "archived"
      ? "Dieser Kanal ist archiviert. Neue Nachrichten sind nicht möglich."
      : "Diese Person ist kein aktives Mitglied mehr. Die Unterhaltung ist schreibgeschützt.",
  );
}

/** Manage = rename, archive, member management. */
async function canManage(db: DbOrTx, conv: Conversation, ctx: AuthContext): Promise<boolean> {
  if (conv.kind === "dm") return false;
  const isResponsible = conv.ownerId === ctx.userId;
  if (conv.kind === "open_channel") return isResponsible || ctx.role === "admin";
  // Private: management always requires channel membership; admin role alone is not enough.
  if (!(await isParticipant(db, conv.id, ctx.userId))) return false;
  return isResponsible || ctx.role === "admin";
}

async function assertManage(db: DbOrTx, conv: Conversation, ctx: AuthContext) {
  if (!(await canManage(db, conv, ctx))) {
    throw new AppError("FORBIDDEN", "Nur die verantwortliche Person oder Admins können diesen Kanal verwalten.");
  }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listConversations(ctx: AuthContext): Promise<ConversationSummary[]> {
  const db = getDb();
  await ensureDefaultChannel(db, ctx.workspaceId);
  const rows = await db
    .select({ conv: conversations, lastReadSeq: conversationReadStates.lastReadSeq })
    .from(conversations)
    .leftJoin(
      conversationReadStates,
      and(eq(conversationReadStates.conversationId, conversations.id), eq(conversationReadStates.userId, ctx.userId)),
    )
    .where(
      and(
        eq(conversations.workspaceId, ctx.workspaceId),
        or(
          eq(conversations.kind, "open_channel"),
          sql`exists (select 1 from ${conversationMembers} cm
                      where cm.conversation_id = ${conversations.id} and cm.user_id = ${ctx.userId})`,
        ),
      ),
    )
    .orderBy(asc(sql`lower(coalesce(${conversations.name}, ''))`));

  const dmIds = rows.filter((r) => r.conv.kind === "dm").map((r) => r.conv.id);
  const partners = new Map<string, ChatPerson>();
  if (dmIds.length) {
    const prows = await db
      .select({
        conversationId: conversationMembers.conversationId,
        userId: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        status: workspaceMembers.status,
      })
      .from(conversationMembers)
      .innerJoin(profiles, eq(profiles.id, conversationMembers.userId))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.userId, conversationMembers.userId), eq(workspaceMembers.workspaceId, ctx.workspaceId)),
      )
      .where(and(inArray(conversationMembers.conversationId, dmIds), sql`${conversationMembers.userId} <> ${ctx.userId}`));
    for (const p of prows) {
      partners.set(p.conversationId, {
        userId: p.userId,
        fullName: p.fullName,
        email: p.email,
        active: p.status === "active",
      });
    }
  }

  return rows.map(({ conv, lastReadSeq }) => toSummary(conv, lastReadSeq ?? 0, partners.get(conv.id) ?? null));
}

function toSummary(conv: Conversation, lastReadSeq: number, partner: ChatPerson | null): ConversationSummary {
  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.kind === "dm" ? (partner ? displayName(partner) : "Ehemaliges Mitglied") : (conv.name ?? ""),
    description: conv.description,
    archived: conv.archivedAt !== null,
    isDefault: conv.isDefault,
    ownerId: conv.ownerId,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    lastMessageSeq: conv.lastMessageSeq,
    lastReadSeq,
    unread: conv.lastMessageSeq > lastReadSeq,
    dmPartner: partner,
  };
}

export async function getConversationDetail(ctx: AuthContext, conversationId: string): Promise<ConversationDetail> {
  const db = getDb();
  const conv = await getAccessibleConversation(db, ctx, conversationId);
  const [read] = await db
    .select({ seq: conversationReadStates.lastReadSeq })
    .from(conversationReadStates)
    .where(and(eq(conversationReadStates.conversationId, conv.id), eq(conversationReadStates.userId, ctx.userId)));
  const partner = await dmPartnerOf(db, conv, ctx);
  const members =
    conv.kind === "open_channel"
      ? []
      : (
          await db
            .select({
              userId: profiles.id,
              fullName: profiles.fullName,
              email: profiles.email,
              status: workspaceMembers.status,
            })
            .from(conversationMembers)
            .innerJoin(profiles, eq(profiles.id, conversationMembers.userId))
            .innerJoin(
              workspaceMembers,
              and(
                eq(workspaceMembers.userId, conversationMembers.userId),
                eq(workspaceMembers.workspaceId, ctx.workspaceId),
              ),
            )
            .where(eq(conversationMembers.conversationId, conv.id))
            .orderBy(asc(sql`lower(coalesce(${profiles.fullName}, ${profiles.email}))`))
        ).map((m) => ({ userId: m.userId, fullName: m.fullName, email: m.email, active: m.status === "active" }));
  const post = await postability(db, conv, ctx);
  return {
    ...toSummary(conv, read?.seq ?? 0, partner),
    createdBy: conv.createdBy,
    createdAt: conv.createdAt.toISOString(),
    members,
    canPost: post.canPost,
    readOnlyReason: post.reason,
    canManage: await canManage(db, conv, ctx),
  };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

async function assertActiveMembers(db: DbOrTx, ctx: AuthContext, userIds: string[]) {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.status, "active"),
        inArray(workspaceMembers.userId, userIds),
      ),
    );
  if (rows.length !== new Set(userIds).size) throw invalid("Mindestens eine Person ist kein aktives Mitglied.");
}

export async function createChannel(
  ctx: AuthContext,
  input: z.output<typeof createChannelSchema>,
): Promise<{ id: string }> {
  return getDb().transaction(async (tx) => {
    if (input.id) {
      // Idempotent retry: the caller's channel with this id already exists.
      const [existing] = await tx
        .select({ id: conversations.id, workspaceId: conversations.workspaceId, createdBy: conversations.createdBy })
        .from(conversations)
        .where(eq(conversations.id, input.id));
      if (existing) {
        if (existing.workspaceId !== ctx.workspaceId || existing.createdBy !== ctx.userId) {
          throw new AppError("CONFLICT", "Dieser Kanal konnte nicht angelegt werden.");
        }
        return { id: existing.id };
      }
    }
    const isPrivate = input.visibility === "private";
    const memberIds = isPrivate ? [...new Set([ctx.userId, ...input.memberIds])] : [];
    await assertActiveMembers(tx, ctx, memberIds);
    const [conv] = await tx
      .insert(conversations)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        kind: isPrivate ? "private_channel" : "open_channel",
        name: input.name,
        description: input.description,
        createdBy: ctx.userId,
        ownerId: ctx.userId,
      })
      .returning({ id: conversations.id });
    if (memberIds.length) {
      await tx.insert(conversationMembers).values(
        memberIds.map((userId) => ({
          conversationId: conv.id,
          workspaceId: ctx.workspaceId,
          userId,
          addedBy: ctx.userId,
        })),
      );
    }
    return conv;
  });
}

export async function updateChannel(ctx: AuthContext, input: z.output<typeof updateChannelSchema>): Promise<void> {
  await getDb().transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.id, { lock: true });
    await assertManage(tx, conv, ctx);
    if (conv.archivedAt) throw new AppError("ARCHIVED", "Archivierte Kanäle können nicht bearbeitet werden.");
    await tx
      .update(conversations)
      .set({ name: input.name, description: input.description, updatedAt: new Date() })
      .where(eq(conversations.id, conv.id));
  });
}

export async function setChannelArchived(
  ctx: AuthContext,
  input: z.output<typeof archiveChannelSchema>,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.id, { lock: true });
    await assertManage(tx, conv, ctx);
    if (conv.isDefault && input.archived) throw invalid("Der Kanal „Allgemein“ kann nicht archiviert werden.");
    await tx
      .update(conversations)
      .set({ archivedAt: input.archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(conversations.id, conv.id));
  });
}

export async function addChannelMembers(
  ctx: AuthContext,
  input: z.output<typeof channelMembersSchema>,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.id, { lock: true });
    if (conv.kind !== "private_channel") throw invalid("Mitglieder gibt es nur bei geschlossenen Kanälen.");
    await assertManage(tx, conv, ctx);
    if (conv.archivedAt) throw new AppError("ARCHIVED", "Archivierte Kanäle können nicht bearbeitet werden.");
    await assertActiveMembers(tx, ctx, input.userIds);
    await tx
      .insert(conversationMembers)
      .values(
        input.userIds.map((userId) => ({
          conversationId: conv.id,
          workspaceId: ctx.workspaceId,
          userId,
          addedBy: ctx.userId,
        })),
      )
      .onConflictDoNothing();
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id));
  });
}

/**
 * Removes a member from a private channel (managers) or leaves it (self).
 * The responsible member can only leave/be removed when responsibility is
 * handed over or the channel is archived — no orphaned private channels.
 */
export async function removeChannelMember(
  ctx: AuthContext,
  input: z.output<typeof removeChannelMemberSchema>,
): Promise<{ archived: boolean }> {
  return getDb().transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.id, { lock: true });
    if (conv.kind !== "private_channel") throw invalid("Mitglieder gibt es nur bei geschlossenen Kanälen.");
    const self = input.userId === ctx.userId;
    if (!self) await assertManage(tx, conv, ctx);
    if (!(await isParticipant(tx, conv.id, input.userId))) throw invalid("Diese Person ist kein Mitglied des Kanals.");

    const remaining = (
      await tx
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .innerJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.userId, conversationMembers.userId),
            eq(workspaceMembers.workspaceId, conversationMembers.workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .where(and(eq(conversationMembers.conversationId, conv.id), sql`${conversationMembers.userId} <> ${input.userId}`))
    ).map((r) => r.userId);

    let archived = false;
    const patch: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
    if (conv.ownerId === input.userId) {
      if (input.archive || remaining.length === 0) {
        patch.archivedAt = conv.archivedAt ?? new Date();
        archived = true;
      } else if (input.newOwnerId && remaining.includes(input.newOwnerId)) {
        patch.ownerId = input.newOwnerId;
      } else {
        throw invalid("Bitte übergib die Verantwortung an ein verbleibendes Mitglied oder archiviere den Kanal.", {
          newOwnerId: "Bitte wähle eine neue verantwortliche Person.",
        });
      }
    }
    await tx
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, input.userId)));
    await tx.update(conversations).set(patch).where(eq(conversations.id, conv.id));
    return { archived };
  });
}

/**
 * Called when a member is removed from the workspace (same transaction):
 * private channel memberships end, responsibility moves to the earliest
 * remaining active member, or the channel is archived if nobody remains.
 * DM participation rows stay so the other person keeps the history.
 */
export async function handleWorkspaceMemberRemoval(tx: Tx, workspaceId: string, userId: string): Promise<void> {
  const owned = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.kind, "private_channel"),
        eq(conversations.ownerId, userId),
      ),
    );
  for (const { id } of owned) {
    const [next] = await tx
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, conversationMembers.userId),
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .where(and(eq(conversationMembers.conversationId, id), sql`${conversationMembers.userId} <> ${userId}`))
      .orderBy(asc(conversationMembers.createdAt))
      .limit(1);
    await tx
      .update(conversations)
      .set(next ? { ownerId: next.userId, updatedAt: new Date() } : { archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id));
  }
  await tx.execute(sql`
    DELETE FROM ${conversationMembers} cm
     USING ${conversations} c
     WHERE cm.conversation_id = c.id
       AND c.kind = 'private_channel'
       AND cm.workspace_id = ${workspaceId}
       AND cm.user_id = ${userId}`);
}

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

export function dmKeyFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Opens (or creates exactly once) the DM between the caller and `userId`. */
export async function openDm(ctx: AuthContext, userId: string): Promise<{ id: string }> {
  if (userId === ctx.userId) throw invalid("Du kannst keine Unterhaltung mit dir selbst beginnen.");
  return getDb().transaction(async (tx) => {
    await assertActiveMembers(tx, ctx, [userId]);
    const key = dmKeyFor(ctx.userId, userId);
    // The unique index (workspace_id, dm_key) serializes concurrent creation.
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO ${conversations} (workspace_id, kind, dm_key, created_by)
      VALUES (${ctx.workspaceId}, 'dm', ${key}, ${ctx.userId})
      ON CONFLICT (workspace_id, dm_key) WHERE dm_key IS NOT NULL DO NOTHING
      RETURNING id`);
    let id = inserted[0]?.id;
    if (!id) {
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, ctx.workspaceId), eq(conversations.dmKey, key)));
      id = existing.id;
    }
    await tx
      .insert(conversationMembers)
      .values([
        { conversationId: id, workspaceId: ctx.workspaceId, userId: ctx.userId, addedBy: ctx.userId },
        { conversationId: id, workspaceId: ctx.workspaceId, userId, addedBy: ctx.userId },
      ])
      .onConflictDoNothing();
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function attachmentsFor(db: DbOrTx, messageIds: string[]): Promise<Map<string, AttachmentDTO[]>> {
  const map = new Map<string, AttachmentDTO[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      fileName: messageAttachments.fileName,
      mimeType: messageAttachments.mimeType,
      sizeBytes: messageAttachments.sizeBytes,
    })
    .from(messageAttachments)
    .where(and(inArray(messageAttachments.messageId, messageIds), eq(messageAttachments.status, "attached")))
    .orderBy(asc(messageAttachments.createdAt));
  for (const r of rows) {
    const list = map.get(r.messageId!) ?? [];
    list.push({ id: r.id, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes });
    map.set(r.messageId!, list);
  }
  return map;
}

type NameOf = (userId: string) => string | null | undefined;

type IssueRefs = Map<string, IssueRefDTO>;

function toMessageDTO(m: Message, attachments: AttachmentDTO[], nameOf: NameOf, refs: IssueRefs = new Map()): MessageDTO {
  const markup = m.deletedAt ? "" : m.body;
  const issueRefIds = extractIssueRefIds(markup);
  return {
    id: m.id,
    seq: m.seq,
    conversationId: m.conversationId,
    authorId: m.authorId,
    body: renderIssueRefsPlain(renderMentionsPlain(markup, nameOf), (id) => refs.get(id)?.number),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deleted: m.deletedAt !== null,
    attachments: m.deletedAt ? [] : attachments,
    markup,
    mentionIds: extractMentionIds(markup),
    issueRefs: issueRefIds.flatMap((id) => refs.get(id) ?? []),
  };
}

/** Referenced tasks of the given messages that the reader can see (same workspace, not deleted). */
async function issueRefsFor(db: DbOrTx, ctx: AuthContext, rows: Message[]): Promise<IssueRefs> {
  const ids = rows.flatMap((r) => (r.deletedAt ? [] : extractIssueRefIds(r.body)));
  return new Map((await resolveIssueRefs(db, ctx, ids)).map((t) => [t.id, t]));
}

/** Authors and mentioned people of the given messages, plus a name lookup. */
async function peopleFor(db: DbOrTx, ctx: AuthContext, rows: Message[]): Promise<{ people: ChatPerson[]; nameOf: NameOf }> {
  const people = await authorsFor(
    db,
    ctx,
    rows.flatMap((r) => [r.authorId, ...(r.deletedAt ? [] : extractMentionIds(r.body))]),
  );
  const byId = new Map(people.map((p) => [p.userId, p]));
  return {
    people,
    nameOf: (id) => {
      const p = byId.get(id);
      return p ? displayName(p) : null;
    },
  };
}

/**
 * Mentions must point to people who can read the conversation: active
 * workspace members, and for private channels / DMs explicit participants.
 * Mentions already present in an edited message stay allowed (the person may
 * have left since); only newly added ones are checked. Ids from the request
 * prove nothing, so every new one is verified against the database.
 */
async function assertMentionable(
  db: DbOrTx,
  ctx: AuthContext,
  conv: Conversation,
  mentionIds: string[],
  alreadyMentioned: string[] = [],
): Promise<string[]> {
  if (mentionIds.length > CHAT_LIMITS.maxMentionsPerMessage) {
    const msg = `Du kannst höchstens ${CHAT_LIMITS.maxMentionsPerMessage} Personen in einer Nachricht erwähnen.`;
    throw invalid(msg, { body: msg });
  }
  const added = mentionIds.filter((id) => !alreadyMentioned.includes(id));
  if (added.length === 0) return [];
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.status, "active"),
        inArray(workspaceMembers.userId, added),
        conv.kind === "open_channel"
          ? undefined
          : sql`exists (select 1 from ${conversationMembers} cm
                        where cm.conversation_id = ${conv.id} and cm.user_id = ${workspaceMembers.userId})`,
      ),
    );
  if (rows.length !== added.length) {
    const msg = "Mindestens eine erwähnte Person hat keinen Zugriff auf diese Unterhaltung.";
    throw invalid(msg, { body: msg });
  }
  return added;
}

/** Everyone who can currently read the conversation: active members (open channel) or active participants. */
async function conversationAudience(db: DbOrTx, ctx: AuthContext, conv: Conversation): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.status, "active"),
        conv.kind === "open_channel"
          ? undefined
          : sql`exists (select 1 from ${conversationMembers} cm
                        where cm.conversation_id = ${conv.id} and cm.user_id = ${workspaceMembers.userId})`,
      ),
    );
  return rows.map((r) => r.userId);
}

/**
 * Who a message notifies: individually mentioned people plus, with `<@all>`,
 * everyone who can read the conversation. `added` are the ones that are new
 * compared to the previous version (an `<@all>` that was already there does
 * not notify again, e.g. people who joined later).
 */
async function mentionRecipients(
  db: DbOrTx,
  ctx: AuthContext,
  conv: Conversation,
  body: string,
  addedIndividuals: string[],
  previousBody: string | null = null,
): Promise<{ current: string[]; added: string[] }> {
  const individuals = extractMentionIds(body);
  if (!mentionsAll(body)) return { current: individuals, added: addedIndividuals };
  const audience = await conversationAudience(db, ctx, conv);
  const current = [...new Set([...individuals, ...audience])];
  const allIsNew = previousBody === null || !mentionsAll(previousBody);
  return { current, added: allIsNew ? current : addedIndividuals };
}

/**
 * Cursor pagination by seq:
 *  - default: newest page,
 *  - beforeSeq: older page (scrolling up),
 *  - afterSeq: everything newer (resync after reconnect, bounded).
 * Always returned in ascending order.
 */
async function authorsFor(db: DbOrTx, ctx: AuthContext, ids: string[]): Promise<ChatPerson[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ userId: profiles.id, fullName: profiles.fullName, email: profiles.email, status: workspaceMembers.status })
    .from(profiles)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.userId, profiles.id), eq(workspaceMembers.workspaceId, ctx.workspaceId)),
    )
    .where(inArray(profiles.id, unique));
  return rows.map((r) => ({ userId: r.userId, fullName: r.fullName, email: r.email, active: r.status === "active" }));
}

export async function listMessages(
  ctx: AuthContext,
  input: z.output<typeof listMessagesSchema>,
): Promise<{ messages: MessageDTO[]; hasMore: boolean; authors: ChatPerson[] }> {
  const db = getDb();
  const conv = await getAccessibleConversation(db, ctx, input.conversationId);
  const limit = CHAT_LIMITS.pageSize;
  const base = eq(messages.conversationId, conv.id);

  let rows: Message[];
  let hasMore = false;
  if (input.afterSeq !== null) {
    rows = await db
      .select()
      .from(messages)
      .where(and(base, gt(messages.seq, input.afterSeq)))
      .orderBy(asc(messages.seq))
      .limit(limit * 4 + 1);
    hasMore = rows.length > limit * 4;
    rows = rows.slice(0, limit * 4);
  } else {
    rows = await db
      .select()
      .from(messages)
      .where(input.beforeSeq !== null ? and(base, lt(messages.seq, input.beforeSeq)) : base)
      .orderBy(desc(messages.seq))
      .limit(limit + 1);
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }
  const att = await attachmentsFor(
    db,
    rows.filter((r) => r.attachmentCount > 0).map((r) => r.id),
  );
  const { people, nameOf } = await peopleFor(db, ctx, rows);
  const refs = await issueRefsFor(db, ctx, rows);
  return {
    messages: rows.map((r) => toMessageDTO(r, att.get(r.id) ?? [], nameOf, refs)),
    hasMore,
    // Authors and mentioned people (clients resolve both by id).
    authors: people,
  };
}

export async function getMessage(
  ctx: AuthContext,
  messageId: string,
): Promise<{ message: MessageDTO; author: ChatPerson | null }> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.workspaceId, ctx.workspaceId)));
  if (!m) throw new AppError("NOT_FOUND", "Nachricht nicht gefunden.");
  await getAccessibleConversation(db, ctx, m.conversationId);
  const att = await attachmentsFor(db, [m.id]);
  const { people, nameOf } = await peopleFor(db, ctx, [m]);
  const author = people.find((p) => p.userId === m.authorId) ?? null;
  return { message: toMessageDTO(m, att.get(m.id) ?? [], nameOf, await issueRefsFor(db, ctx, [m])), author };
}

/**
 * Idempotent send: the client generates the message id. Retrying with the
 * same id returns the stored message instead of creating a duplicate.
 */
export async function sendMessage(ctx: AuthContext, input: z.output<typeof sendMessageSchema>): Promise<MessageDTO> {
  const body = input.body.replace(/\s+$/u, "");
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (!body.trim() && attachmentIds.length === 0) throw invalid("Die Nachricht ist leer.", { body: "Die Nachricht ist leer." });

  let created = false;
  const result = await getDb().transaction(async (tx) => {
    const conv = await getAccessibleConversation(tx, ctx, input.conversationId, { lock: true });

    const [existing] = await tx.select().from(messages).where(eq(messages.id, input.id));
    if (existing) {
      if (existing.authorId !== ctx.userId || existing.conversationId !== conv.id) {
        throw new AppError("CONFLICT", "Diese Nachricht konnte nicht gesendet werden.");
      }
      const att = await attachmentsFor(tx, [existing.id]);
      return toMessageDTO(
        existing,
        att.get(existing.id) ?? [],
        (await peopleFor(tx, ctx, [existing])).nameOf,
        await issueRefsFor(tx, ctx, [existing]),
      );
    }
    created = true;

    assertWritable(await postability(tx, conv, ctx));
    const mentionIds = extractMentionIds(body);
    const addedMentions = await assertMentionable(tx, ctx, conv, mentionIds);
    await assertReferenceable(tx, ctx, extractIssueRefIds(body));

    let ready: { id: string }[] = [];
    if (attachmentIds.length) {
      ready = await tx
        .select({ id: messageAttachments.id })
        .from(messageAttachments)
        .where(
          and(
            inArray(messageAttachments.id, attachmentIds),
            eq(messageAttachments.uploaderId, ctx.userId),
            eq(messageAttachments.conversationId, conv.id),
            eq(messageAttachments.status, "uploaded"),
            isNull(messageAttachments.messageId),
          ),
        )
        .for("update");
      if (ready.length !== attachmentIds.length) {
        throw invalid("Mindestens ein Anhang ist nicht (mehr) bereit. Bitte lade ihn erneut hoch.");
      }
    }

    const [msg] = await tx
      .insert(messages)
      .values({
        id: input.id,
        conversationId: conv.id,
        workspaceId: ctx.workspaceId,
        authorId: ctx.userId,
        body,
        attachmentCount: attachmentIds.length,
      })
      .returning();

    if (attachmentIds.length) {
      await tx
        .update(messageAttachments)
        .set({ messageId: msg.id, status: "attached", expiresAt: null, updatedAt: new Date() })
        .where(inArray(messageAttachments.id, attachmentIds));
    }
    await tx
      .update(conversations)
      .set({
        lastMessageSeq: sql`greatest(${conversations.lastMessageSeq}, ${msg.seq})`,
        lastMessageAt: msg.createdAt,
      })
      .where(eq(conversations.id, conv.id));
    await upsertReadState(tx, ctx, conv.id, msg.seq);
    await syncMentionNotifications(tx, ctx, msg, await mentionRecipients(tx, ctx, conv, body, addedMentions));

    const att = await attachmentsFor(tx, [msg.id]);
    return toMessageDTO(msg, att.get(msg.id) ?? [], (await peopleFor(tx, ctx, [msg])).nameOf, await issueRefsFor(tx, ctx, [msg]));
  });
  // After commit and only for new messages (a retried send must not notify twice).
  if (created) notifyNewMessage(result.id);
  return result;
}

async function lockOwnMessage(tx: Tx, ctx: AuthContext, id: string): Promise<{ msg: Message; conv: Conversation }> {
  const [msg] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!msg) throw new AppError("NOT_FOUND", "Nachricht nicht gefunden.");
  const conv = await getAccessibleConversation(tx, ctx, msg.conversationId);
  if (msg.authorId !== ctx.userId) throw new AppError("FORBIDDEN", "Du kannst nur eigene Nachrichten ändern.");
  if (msg.deletedAt) throw new AppError("NOT_FOUND", "Diese Nachricht wurde gelöscht.");
  return { msg, conv };
}

export async function editMessage(ctx: AuthContext, input: z.output<typeof editMessageSchema>): Promise<MessageDTO> {
  return getDb().transaction(async (tx) => {
    const { msg, conv } = await lockOwnMessage(tx, ctx, input.id);
    assertWritable(await postability(tx, conv, ctx));
    const body = input.body.replace(/\s+$/u, "");
    if (!body.trim() && msg.attachmentCount === 0) throw invalid("Die Nachricht ist leer.", { body: "Die Nachricht ist leer." });
    const mentionIds = extractMentionIds(body);
    const addedMentions = await assertMentionable(tx, ctx, conv, mentionIds, extractMentionIds(msg.body));
    await assertReferenceable(tx, ctx, extractIssueRefIds(body), extractIssueRefIds(msg.body));
    const [updated] = await tx
      .update(messages)
      .set({ body, editedAt: body === msg.body ? msg.editedAt : new Date() })
      .where(eq(messages.id, msg.id))
      .returning();
    await syncMentionNotifications(tx, ctx, msg, await mentionRecipients(tx, ctx, conv, body, addedMentions, msg.body));
    const att = await attachmentsFor(tx, [msg.id]);
    return toMessageDTO(
      updated,
      att.get(msg.id) ?? [],
      (await peopleFor(tx, ctx, [updated])).nameOf,
      await issueRefsFor(tx, ctx, [updated]),
    );
  });
}

/** Soft delete: content and attachments go, a placeholder remains. */
export async function deleteMessage(ctx: AuthContext, id: string): Promise<MessageDTO> {
  const result = await getDb().transaction(async (tx) => {
    const { msg } = await lockOwnMessage(tx, ctx, id);
    await tx
      .update(messageAttachments)
      .set({ status: "deleting", updatedAt: new Date() })
      .where(eq(messageAttachments.messageId, msg.id));
    const [updated] = await tx
      .update(messages)
      .set({ body: "", attachmentCount: 0, deletedAt: new Date() })
      .where(eq(messages.id, msg.id))
      .returning();
    await deleteMessageNotifications(tx, msg.id);
    return updated;
  });
  // Storage is not transactional: free the files now; failures stay in
  // status "deleting" and are retried by the cleanup job.
  await deleteAttachmentFiles({ messageId: result.id }).catch((err) =>
    console.error("[chat] attachment cleanup deferred:", err instanceof Error ? err.message : String(err)),
  );
  return toMessageDTO(result, [], () => null);
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

async function upsertReadState(db: DbOrTx, ctx: AuthContext, conversationId: string, seq: number) {
  await db.execute(sql`
    INSERT INTO ${conversationReadStates} (conversation_id, user_id, workspace_id, last_read_seq, updated_at)
    VALUES (${conversationId}, ${ctx.userId}, ${ctx.workspaceId}, ${seq}, now())
    ON CONFLICT (conversation_id, user_id) DO UPDATE
      SET last_read_seq = excluded.last_read_seq, updated_at = now()
      WHERE ${conversationReadStates}.last_read_seq < excluded.last_read_seq`);
}

/** Only moves forward and never beyond the latest message. */
export async function markRead(ctx: AuthContext, input: z.output<typeof markReadSchema>): Promise<{ lastReadSeq: number }> {
  const db = getDb();
  const conv = await getAccessibleConversation(db, ctx, input.conversationId);
  const seq = Math.min(input.seq, conv.lastMessageSeq);
  if (seq > 0) {
    await upsertReadState(db, ctx, conv.id, seq);
    await markConversationNotificationsRead(db, ctx, conv.id, seq);
  }
  return { lastReadSeq: seq };
}
