"use server";

import { runAction } from "@/server/action";
import * as decisions from "@vistoo/backend/services/decisions";
import {
  addDecisionRelationSchema,
  createDecisionLinkSchema,
  createDecisionSchema,
  decisionIdSchema,
  listDecisionsSchema,
  relationCandidatesSchema,
  supersedeDecisionSchema,
  updateDecisionLinkSchema,
  updateDecisionSchema,
} from "@vistoo/domain/decisions";
import { idSchema } from "@vistoo/domain/validation";

export async function listDecisionsAction(input: unknown) {
  return runAction(listDecisionsSchema, input, (ctx, data) => decisions.listDecisions(ctx, data));
}

export async function getDecisionAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => decisions.getDecision(ctx, data.id));
}

export async function createDecisionAction(input: unknown) {
  return runAction(createDecisionSchema, input, (ctx, data) => decisions.createDecision(ctx, data));
}

export async function updateDecisionAction(input: unknown) {
  return runAction(updateDecisionSchema, input, (ctx, data) => decisions.updateDecision(ctx, data));
}

export async function deleteDecisionAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => decisions.deleteDecision(ctx, data.id));
}

export async function supersedeDecisionAction(input: unknown) {
  return runAction(supersedeDecisionSchema, input, (ctx, data) => decisions.supersedeDecision(ctx, data));
}

export async function listSupersedeCandidatesAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => decisions.listSupersedeCandidates(ctx, data.id));
}

export async function listDecisionLinksAction(input: unknown) {
  return runAction(decisionIdSchema, input, (ctx, data) => decisions.listDecisionLinks(ctx, data.decisionId));
}

export async function createDecisionLinkAction(input: unknown) {
  return runAction(createDecisionLinkSchema, input, (ctx, data) => decisions.createDecisionLink(ctx, data));
}

export async function updateDecisionLinkAction(input: unknown) {
  return runAction(updateDecisionLinkSchema, input, (ctx, data) => decisions.updateDecisionLink(ctx, data));
}

export async function deleteDecisionLinkAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => decisions.deleteDecisionLink(ctx, data.id));
}

export async function listRelationCandidatesAction(input: unknown) {
  return runAction(relationCandidatesSchema, input, (ctx, data) => decisions.listRelationCandidates(ctx, data));
}

export async function addDecisionRelationAction(input: unknown) {
  return runAction(addDecisionRelationSchema, input, (ctx, data) => decisions.addDecisionRelation(ctx, data));
}

export async function removeDecisionRelationAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => decisions.removeDecisionRelation(ctx, data.id));
}
