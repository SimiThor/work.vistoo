"use server";

import { runAction } from "@/server/action";
import * as ideas from "@vistoo/backend/services/ideas";
import { createIdeaSchema, createIssueFromIdeaSchema, updateIdeaSchema } from "@vistoo/domain/ideas";
import { idSchema } from "@vistoo/domain/validation";

export async function createIdeaAction(input: unknown) {
  return runAction(createIdeaSchema, input, (ctx, data) => ideas.createIdea(ctx, data));
}

export async function updateIdeaAction(input: unknown) {
  return runAction(updateIdeaSchema, input, (ctx, data) => ideas.updateIdea(ctx, data));
}

export async function deleteIdeaAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => ideas.deleteIdea(ctx, data.id));
}

export async function createIssueFromIdeaAction(input: unknown) {
  return runAction(createIssueFromIdeaSchema, input, (ctx, data) => ideas.createIssueFromIdea(ctx, data));
}
