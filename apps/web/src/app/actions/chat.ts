"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction } from "@/server/action";
import * as chat from "@vistoo/backend/services/chat";
import * as files from "@vistoo/backend/services/chat-files";
import * as inbox from "@vistoo/backend/services/inbox";
import { listMembers } from "@vistoo/backend/services/team";
import {
  archiveChannelSchema,
  channelMembersSchema,
  createChannelSchema,
  editMessageSchema,
  idSchema,
  listMessagesSchema,
  markNotificationsReadSchema,
  markReadSchema,
  openDmSchema,
  removeChannelMemberSchema,
  reserveUploadSchema,
  sendMessageSchema,
  updateChannelSchema,
} from "@vistoo/domain/validation";

const empty = z.object({});

/** Everything the chat shell needs on mount: who am I, conversations, people. */
export async function chatBootstrapAction() {
  return runAction(empty, {}, async (ctx) => {
    const [conversations, members] = await Promise.all([chat.listConversations(ctx), listMembers(ctx)]);
    return { me: { userId: ctx.userId, role: ctx.role }, workspaceId: ctx.workspaceId, conversations, members };
  });
}

export async function listConversationsAction() {
  return runAction(empty, {}, (ctx) => chat.listConversations(ctx));
}

export async function conversationDetailAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => chat.getConversationDetail(ctx, d.id));
}

export async function listMessagesAction(input: unknown) {
  return runAction(listMessagesSchema, input, (ctx, d) => chat.listMessages(ctx, d));
}

export async function getMessageAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => chat.getMessage(ctx, d.id));
}

export async function sendMessageAction(input: unknown) {
  return runAction(sendMessageSchema, input, (ctx, d) => chat.sendMessage(ctx, d));
}

export async function editMessageAction(input: unknown) {
  return runAction(editMessageSchema, input, (ctx, d) => chat.editMessage(ctx, d));
}

export async function deleteMessageAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => chat.deleteMessage(ctx, d.id));
}

export async function markReadAction(input: unknown) {
  return runAction(markReadSchema, input, (ctx, d) => chat.markRead(ctx, d));
}

export async function createChannelAction(input: unknown) {
  return runAction(createChannelSchema, input, (ctx, d) => chat.createChannel(ctx, d));
}

export async function updateChannelAction(input: unknown) {
  return runAction(updateChannelSchema, input, (ctx, d) => chat.updateChannel(ctx, d));
}

export async function setChannelArchivedAction(input: unknown) {
  return runAction(archiveChannelSchema, input, (ctx, d) => chat.setChannelArchived(ctx, d));
}

export async function addChannelMembersAction(input: unknown) {
  return runAction(channelMembersSchema, input, (ctx, d) => chat.addChannelMembers(ctx, d));
}

export async function removeChannelMemberAction(input: unknown) {
  return runAction(removeChannelMemberSchema, input, (ctx, d) => chat.removeChannelMember(ctx, d));
}

export async function openDmAction(input: unknown) {
  return runAction(openDmSchema, input, (ctx, d) => chat.openDm(ctx, d.userId));
}

export async function reserveUploadAction(input: unknown) {
  return runAction(reserveUploadSchema, input, (ctx, d) => files.reserveUpload(ctx, d));
}

export async function finalizeUploadAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => files.finalizeUpload(ctx, d.id));
}

export async function discardUploadAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => files.discardUpload(ctx, d.id));
}

export async function downloadUrlAction(input: unknown) {
  return runAction(idSchema, input, (ctx, d) => files.getDownloadUrl(ctx, d.id));
}

export async function chatStorageUsageAction() {
  const res = await runAction(empty, {}, (ctx) => files.getChatStorageUsage(ctx), { admin: true });
  return res;
}

export async function listNotificationsAction() {
  return runAction(empty, {}, (ctx) => inbox.listNotifications(ctx));
}

export async function markNotificationsReadAction(input: unknown) {
  return runAction(markNotificationsReadSchema, input, (ctx, d) => inbox.markNotificationsRead(ctx, d));
}

/** Used after membership changes so server-rendered pieces pick them up. */
export async function refreshAction() {
  refresh();
}
