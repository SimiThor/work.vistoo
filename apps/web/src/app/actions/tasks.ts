"use server";

import { z } from "zod";
import { runAction } from "@/server/action";
import * as tasks from "@vistoo/backend/services/tasks";
import {
  createTaskSchema,
  idSchema,
  moveTaskSchema,
  setAssigneesSchema,
  setChecklistItemSchema,
  setStatusSchema,
  updateTaskSchema,
  uuid,
} from "@vistoo/domain/validation";

export async function createTaskAction(input: unknown) {
  return runAction(createTaskSchema, input, (ctx, data) => tasks.createTask(ctx, data));
}

export async function updateTaskAction(input: unknown) {
  return runAction(updateTaskSchema, input, (ctx, data) => tasks.updateTask(ctx, data));
}

export async function moveTaskAction(input: unknown) {
  return runAction(moveTaskSchema, input, (ctx, data) => tasks.moveTask(ctx, data));
}

export async function setTaskStatusAction(input: unknown) {
  return runAction(setStatusSchema, input, (ctx, data) => tasks.setTaskStatus(ctx, data));
}

export async function setTaskAssigneesAction(input: unknown) {
  return runAction(setAssigneesSchema, input, (ctx, data) => tasks.setTaskAssignees(ctx, data));
}

export async function setTaskChecklistItemAction(input: unknown) {
  return runAction(setChecklistItemSchema, input, (ctx, data) => tasks.setTaskChecklistItem(ctx, data));
}

export async function deleteTaskAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => tasks.deleteTask(ctx, data.id));
}

export async function getTaskAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => tasks.getTask(ctx, data.id));
}

/** Full re-sync after a realtime reconnect. */
export async function listTasksAction(input: unknown) {
  return runAction(
    z.object({ projectId: uuid.nullable(), milestoneId: uuid.nullable().default(null) }),
    input,
    (ctx, data) =>
      tasks.listTasks(ctx, {
        ...(data.projectId ? { projectId: data.projectId } : {}),
        ...(data.milestoneId ? { milestoneId: data.milestoneId } : {}),
      }),
  );
}
