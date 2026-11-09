"use server";

import { runAction } from "@/server/action";
import * as taskLinks from "@vistoo/backend/services/task-links";
import { createTaskLinkSchema, idSchema, taskIdSchema, updateTaskLinkSchema } from "@vistoo/domain/validation";

export async function listTaskLinksAction(input: unknown) {
  return runAction(taskIdSchema, input, (ctx, data) => taskLinks.listTaskLinks(ctx, data.taskId));
}

export async function createTaskLinkAction(input: unknown) {
  return runAction(createTaskLinkSchema, input, (ctx, data) => taskLinks.createTaskLink(ctx, data));
}

export async function updateTaskLinkAction(input: unknown) {
  return runAction(updateTaskLinkSchema, input, (ctx, data) => taskLinks.updateTaskLink(ctx, data));
}

export async function deleteTaskLinkAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => taskLinks.deleteTaskLink(ctx, data.id));
}
