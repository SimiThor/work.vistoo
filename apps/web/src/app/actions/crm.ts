"use server";

import { z } from "zod";
import { runAction } from "@/server/action";
import * as crm from "@vistoo/backend/services/crm";
import {
  createActivitySchema,
  createAttractionSchema,
  updateActivitySchema,
  updateAttractionSchema,
} from "@vistoo/domain/crm";
import { idSchema, uuid } from "@vistoo/domain/validation";

export async function createAttractionAction(input: unknown) {
  return runAction(createAttractionSchema, input, (ctx, data) => crm.createAttraction(ctx, data));
}

export async function updateAttractionAction(input: unknown) {
  return runAction(updateAttractionSchema, input, (ctx, data) => crm.updateAttraction(ctx, data));
}

export async function deleteAttractionAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => crm.deleteAttraction(ctx, data.id));
}

export async function listActivitiesAction(input: unknown) {
  return runAction(z.object({ attractionId: uuid }), input, (ctx, data) => crm.listActivities(ctx, data.attractionId));
}

export async function addActivityAction(input: unknown) {
  return runAction(createActivitySchema, input, (ctx, data) => crm.addActivity(ctx, data));
}

export async function updateActivityAction(input: unknown) {
  return runAction(updateActivitySchema, input, (ctx, data) => crm.updateActivity(ctx, data));
}

export async function deleteActivityAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => crm.deleteActivity(ctx, data.id));
}
