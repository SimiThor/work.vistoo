import "server-only";
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { ChatPerson } from "@vistoo/domain/chat-types";
import type { NotificationDTO, NotificationPageDTO } from "@vistoo/domain/dto";
import { displayName } from "@vistoo/domain";
import { extractMentionIds, renderMentionsPlain } from "@vistoo/domain/mentions";
import { extractIssueRefIds, renderIssueRefsPlain } from "@vistoo/domain/issue-refs";
import { resolveIssueRefs } from "./issue-refs";
import type { markNotificationsReadSchema } from "@vistoo/domain/validation";
import {
  conversationMembers,
  conversations,
  messages,
  notifications,
  profiles,
  workspaceMembers,
} from "@vistoo/database/schema";
import type { AuthContext } from "../auth";
import { getDb, type DbOrTx, type Tx } from "../db";

/*
 * In-app notifications (persistent, per workspace member). Currently only
 * chat mentions. Who may be mentioned is decided by the chat service before
 * these functions run; listing re-checks conversation access so people who
 * lost access (removed from a private channel) no longer see the entry.
 */

const PAGE_SIZE = 50;

/**
 * Syncs the mention notifications of one message to its current mentions:
 * newly added (and validated) people get exactly one notification (unique per
 * message+user), people no longer mentioned lose theirs. The author never
 * notifies themself. Returns who was newly notified.
 * Runs inside the message transaction.
 */
export async function syncMentionNotifications(
  tx: Tx,
  ctx: AuthContext,
  msg: { id: string; conversationId: string },
  mentioned: { current: string[]; added: string[] },
): Promise<string[]> {
  const keep = mentioned.current.filter((id) => id !== ctx.userId);
  const recipients = mentioned.added.filter((id) => id !== ctx.userId && keep.includes(id));
  await tx
    .delete(notifications)
    .where(
      and(
        eq(notifications.messageId, msg.id),
        eq(notifications.kind, "mention"),
        keep.length ? notInArray(notifications.userId, keep) : undefined,
      ),
    );
  if (recipients.length === 0) return [];
  const inserted = await tx
    .insert(notifications)
    .values(
      recipients.map((userId) => ({
        workspaceId: ctx.workspaceId,
        userId,
        actorId: ctx.userId,
        kind: "mention" as const,
        conversationId: msg.conversationId,
        messageId: msg.id,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: notifications.userId });
  return inserted.map((r) => r.userId);
}

/** A deleted message no longer notifies anybody. */
export async function deleteMessageNotifications(db: DbOrTx, messageId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.messageId, messageId));
}

/** Only notifications in conversations the caller can (still) access. */
function accessible(ctx: AuthContext) {
  return or(
    eq(conversations.kind, "open_channel"),
    sql`exists (select 1 from ${conversationMembers} cm
                where cm.conversation_id = ${notifications.conversationId} and cm.user_id = ${ctx.userId})`,
  );
}

export async function listNotifications(ctx: AuthContext): Promise<NotificationPageDTO> {
  const db = getDb();
  const mine = and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId));
  const rows = await db
    .select({
      n: notifications,
      convKind: conversations.kind,
      convName: conversations.name,
      body: messages.body,
      deletedAt: messages.deletedAt,
    })
    .from(notifications)
    .innerJoin(conversations, eq(conversations.id, notifications.conversationId))
    .innerJoin(messages, eq(messages.id, notifications.messageId))
    .where(and(mine, accessible(ctx)))
    .orderBy(desc(notifications.createdAt))
    .limit(PAGE_SIZE);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(conversations, eq(conversations.id, notifications.conversationId))
    .where(and(mine, isNull(notifications.readAt), accessible(ctx)));

  // People: actors, DM partners and everyone mentioned in the previews.
  const dmIds = rows.filter((r) => r.convKind === "dm").map((r) => r.n.conversationId);
  const partnerOf = new Map<string, string>();
  if (dmIds.length) {
    const prows = await db
      .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, dmIds), sql`${conversationMembers.userId} <> ${ctx.userId}`));
    for (const p of prows) partnerOf.set(p.conversationId, p.userId);
  }
  const mentioned = rows.flatMap((r) => extractMentionIds(r.body));
  const people = await peopleById(db, ctx, [
    ...rows.map((r) => r.n.actorId).filter((x): x is string => Boolean(x)),
    ...partnerOf.values(),
    ...mentioned,
  ]);
  const nameOf = (id: string) => {
    const p = people.get(id);
    return p ? displayName(p) : null;
  };

  const refs = await resolveIssueRefs(db, ctx, rows.flatMap((r) => extractIssueRefIds(r.body)));
  const numberOf = new Map(refs.map((t) => [t.id, t.number]));

  const preview = (body: string) => {
    const flat = renderIssueRefsPlain(renderMentionsPlain(body, nameOf), (id) => numberOf.get(id))
      .replace(/\s+/g, " ")
      .trim();
    return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
  };

  return {
    unreadCount: count,
    notifications: rows.map(({ n, convKind, convName, body, deletedAt }): NotificationDTO => {
      const partner = partnerOf.get(n.conversationId);
      return {
        id: n.id,
        kind: n.kind,
        actor: n.actorId ? (people.get(n.actorId) ?? null) : null,
        conversationId: n.conversationId,
        conversationTitle:
          convKind === "dm" ? ((partner && nameOf(partner)) ?? "Ehemaliges Mitglied") : (convName ?? ""),
        conversationKind: convKind,
        messageId: n.messageId,
        preview: deletedAt ? "" : preview(body),
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      };
    }),
  };
}

export async function markNotificationsRead(
  ctx: AuthContext,
  input: z.output<typeof markNotificationsReadSchema>,
): Promise<{ unreadCount: number }> {
  const db = getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        eq(notifications.workspaceId, ctx.workspaceId),
        isNull(notifications.readAt),
        input.ids ? inArray(notifications.id, input.ids) : undefined,
      ),
    );
  const { unreadCount } = await listNotifications(ctx);
  return { unreadCount };
}

/**
 * Reading a conversation up to `seq` also reads the mention notifications of
 * those messages (called by chat.markRead).
 */
export async function markConversationNotificationsRead(
  db: DbOrTx,
  ctx: AuthContext,
  conversationId: string,
  seq: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE ${notifications} n
       SET read_at = now()
      FROM ${messages} m
     WHERE m.id = n.message_id
       AND n.user_id = ${ctx.userId}
       AND n.conversation_id = ${conversationId}
       AND n.read_at IS NULL
       AND m.seq <= ${seq}`);
}

async function peopleById(db: DbOrTx, ctx: AuthContext, ids: string[]): Promise<Map<string, ChatPerson>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ChatPerson>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ userId: profiles.id, fullName: profiles.fullName, email: profiles.email, status: workspaceMembers.status })
    .from(profiles)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.userId, profiles.id), eq(workspaceMembers.workspaceId, ctx.workspaceId)))
    .where(inArray(profiles.id, unique));
  for (const r of rows) {
    map.set(r.userId, { userId: r.userId, fullName: r.fullName, email: r.email, active: r.status === "active" });
  }
  return map;
}
