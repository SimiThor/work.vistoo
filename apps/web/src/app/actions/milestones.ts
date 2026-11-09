"use server";

import { refresh } from "next/cache";
import { runAction } from "@/server/action";
import * as milestones from "@vistoo/backend/services/milestones";
import {
  completeMilestoneSchema,
  createMilestoneSchema,
  idSchema,
  updateMilestoneSchema,
} from "@vistoo/domain/validation";

// Milestones appear in the server-rendered navigation, pickers and filters,
// so the router is refreshed after each successful mutation.

async function withRefresh<T extends { ok: boolean }>(p: Promise<T>): Promise<T> {
  const result = await p;
  if (result.ok) refresh();
  return result;
}

export async function createMilestoneAction(input: unknown) {
  return withRefresh(runAction(createMilestoneSchema, input, (ctx, data) => milestones.createMilestone(ctx, data)));
}

export async function updateMilestoneAction(input: unknown) {
  return withRefresh(runAction(updateMilestoneSchema, input, (ctx, data) => milestones.updateMilestone(ctx, data)));
}

export async function setMilestoneCompletedAction(input: unknown) {
  return withRefresh(
    runAction(completeMilestoneSchema, input, (ctx, data) => milestones.setMilestoneCompleted(ctx, data)),
  );
}

export async function deleteMilestoneAction(input: unknown) {
  return withRefresh(runAction(idSchema, input, (ctx, data) => milestones.deleteMilestone(ctx, data.id)));
}
