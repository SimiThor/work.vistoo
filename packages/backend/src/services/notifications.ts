import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { NotificationSettingsDTO } from "@vistoo/domain/dto";
import type { notificationSettingsPatchSchema, registerDeviceSchema } from "@vistoo/domain/validation";
import {
  conversationMembers,
  conversations,
  messages,
  notificationPreferences,
  profiles,
  projects,
  pushDevices,
  workspaceMembers,
  tasks,
} from "@vistoo/database/schema";
import { displayName } from "@vistoo/domain";
import { extractMentionIds, renderMentionsPlain } from "@vistoo/domain/mentions";
import { extractIssueRefIds, renderIssueRefsPlain } from "@vistoo/domain/issue-refs";
import type { AuthContext, AuthUser } from "../auth";
import { getDb } from "../db";
import { deliver, type PushMessage } from "../push/apns";
import { runInBackground } from "../push/background";

/*
 * Push notifications for native apps.
 *
 * Who is notified is decided here, at send time, with the same access rules
 * as everything else: only ACTIVE workspace members who can read the
 * conversation (open channel: every member; private channel / DM: explicit
 * participants), never the author, filtered by their preferences. Removed
 * members and non-participants of private channels get nothing.
 */

const DEFAULTS: NotificationSettingsDTO = { directMessages: true, channelMessages: true, taskAssignments: true };

// ---------------------------------------------------------------------------
// Devices and preferences
// ---------------------------------------------------------------------------

/** Registers (or moves, after an account switch) this device's token to the caller. */
export async function registerDevice(ctx: AuthContext, input: z.output<typeof registerDeviceSchema>): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(pushDevices)
    .values({ token: input.token, userId: ctx.userId, environment: input.environment })
    .onConflictDoUpdate({
      target: pushDevices.token,
      set: { userId: ctx.userId, environment: input.environment, updatedAt: now },
    });
}

/** Sign-out: the device stops receiving pushes for this user. Works without membership. */
export async function unregisterDevice(user: AuthUser, token: string): Promise<void> {
  await getDb().delete(pushDevices).where(and(eq(pushDevices.token, token), eq(pushDevices.userId, user.id)));
}

export async function getNotificationSettings(ctx: AuthContext): Promise<NotificationSettingsDTO> {
  const [row] = await getDb()
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, ctx.userId));
  return row
    ? { directMessages: row.directMessages, channelMessages: row.channelMessages, taskAssignments: row.taskAssignments }
    : DEFAULTS;
}

export async function updateNotificationSettings(
  ctx: AuthContext,
  patch: z.output<typeof notificationSettingsPatchSchema>,
): Promise<NotificationSettingsDTO> {
  const next = { ...(await getNotificationSettings(ctx)), ...stripUndefined(patch) };
  await getDb()
    .insert(notificationPreferences)
    .values({ userId: ctx.userId, ...next })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...next, updatedAt: new Date() } });
  return next;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function sendToUsers(userIds: string[], message: PushMessage): Promise<number> {
  if (userIds.length === 0) return 0;
  const db = getDb();
  const devices = await db.select().from(pushDevices).where(inArray(pushDevices.userId, userIds));
  let sent = 0;
  await Promise.all(
    devices.map(async (d) => {
      const result = await deliver(d.token, d.environment, message);
      if (result === "sent") sent++;
      if (result === "unregistered") await db.delete(pushDevices).where(eq(pushDevices.token, d.token));
    }),
  );
  return sent;
}

const preview = (body: string, max = 180) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Recipients and content of a new message (exported for tests). */
export async function messagePush(messageId: string): Promise<{ userIds: string[]; message: PushMessage } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      body: messages.body,
      attachmentCount: messages.attachmentCount,
      deletedAt: messages.deletedAt,
      authorId: messages.authorId,
      workspaceId: messages.workspaceId,
      conversationId: messages.conversationId,
      kind: conversations.kind,
      name: conversations.name,
      archivedAt: conversations.archivedAt,
      authorName: profiles.fullName,
      authorEmail: profiles.email,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(profiles, eq(profiles.id, messages.authorId))
    .where(eq(messages.id, messageId));
  if (!row || row.deletedAt) return null;

  const isDm = row.kind === "dm";
  const prefColumn = isDm ? notificationPreferences.directMessages : notificationPreferences.channelMessages;
  const recipients = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, row.workspaceId),
        eq(workspaceMembers.status, "active"),
        sql`${workspaceMembers.userId} <> ${row.authorId}`,
        sql`coalesce(${prefColumn}, true)`,
        row.kind === "open_channel"
          ? undefined
          : sql`exists (select 1 from ${conversationMembers} cm
                        where cm.conversation_id = ${row.conversationId} and cm.user_id = ${workspaceMembers.userId})`,
      ),
    );

  const author = displayName({ fullName: row.authorName, email: row.authorEmail });
  const mentionIds = extractMentionIds(row.body);
  const mentioned = mentionIds.length
    ? await db.select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email }).from(profiles).where(inArray(profiles.id, mentionIds))
    : [];
  const names = new Map(mentioned.map((p) => [p.id, displayName(p)]));
  const refIds = extractIssueRefIds(row.body);
  const refs = refIds.length
    ? await db
        .select({ id: tasks.id, number: tasks.number })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, row.workspaceId), inArray(tasks.id, refIds)))
    : [];
  const numbers = new Map(refs.map((t) => [t.id, t.number]));
  const plain = renderIssueRefsPlain(renderMentionsPlain(row.body, (id) => names.get(id)), (id) => numbers.get(id));
  const text = plain.trim()
    ? preview(plain)
    : row.attachmentCount === 1
      ? "Hat eine Datei gesendet."
      : `Hat ${row.attachmentCount} Dateien gesendet.`;
  return {
    userIds: recipients.map((r) => r.userId),
    message: {
      title: isDm ? author : `#${row.name}`,
      subtitle: isDm ? undefined : author,
      body: text,
      threadId: row.conversationId,
      link: { conversationId: row.conversationId },
    },
  };
}

/** Called after a NEW message was committed (not for idempotent replays). */
export function notifyNewMessage(messageId: string) {
  runInBackground(async () => {
    const push = await messagePush(messageId);
    if (push) await sendToUsers(push.userIds, push.message);
  });
}

/** Recipient and content of an assignment (exported for tests). */
export async function assignmentPush(
  ctx: AuthContext,
  task: { id: string; title: string; projectId: string; assigneeId: string | null },
): Promise<{ userIds: string[]; message: PushMessage } | null> {
  if (!task.assigneeId || task.assigneeId === ctx.userId) return null;
  const db = getDb();
  const [target] = await db
    .select({ userId: workspaceMembers.userId, enabled: sql<boolean>`coalesce(${notificationPreferences.taskAssignments}, true)` })
    .from(workspaceMembers)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        eq(workspaceMembers.userId, task.assigneeId),
        eq(workspaceMembers.status, "active"),
      ),
    );
  if (!target?.enabled) return null;
  const [[actor], [project]] = await Promise.all([
    db.select({ fullName: profiles.fullName, email: profiles.email }).from(profiles).where(eq(profiles.id, ctx.userId)),
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId)),
  ]);
  const by = actor ? displayName(actor) : "Jemand";
  return {
    userIds: [target.userId],
    message: {
      title: "Neue Aufgabe für dich",
      subtitle: project?.name,
      body: `${by} hat dir „${preview(task.title, 120)}“ zugewiesen.`,
      threadId: "tasks",
      link: { taskId: task.id },
    },
  };
}

/** Called after a task got a (new) assignee, from any client. */
export function notifyAssignment(
  ctx: AuthContext,
  task: { id: string; title: string; projectId: string; assigneeId: string | null },
) {
  runInBackground(async () => {
    const push = await assignmentPush(ctx, task);
    if (push) await sendToUsers(push.userIds, push.message);
  });
}
