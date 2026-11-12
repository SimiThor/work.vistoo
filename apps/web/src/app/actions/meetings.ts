"use server";

import { runAction } from "@/server/action";
import * as meetings from "@vistoo/backend/services/meetings";
import {
  addAgendaRelationSchema,
  agendaRelationCandidatesSchema,
  createAgendaItemSchema,
  createDecisionFromAgendaSchema,
  createIssueFromAgendaSchema,
  createMeetingSchema,
  reorderAgendaSchema,
  updateAgendaItemSchema,
  updateMeetingSchema,
} from "@vistoo/domain/meetings";
import { idSchema } from "@vistoo/domain/validation";
import { z } from "zod";

const noInput = z.object({}).optional();

export async function listMeetingsAction(input?: unknown) {
  return runAction(noInput, input, (ctx) => meetings.listMeetings(ctx));
}

export async function getMeetingAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => meetings.getMeeting(ctx, data.id));
}

export async function createMeetingAction(input: unknown) {
  return runAction(createMeetingSchema, input, (ctx, data) => meetings.createMeeting(ctx, data));
}

export async function updateMeetingAction(input: unknown) {
  return runAction(updateMeetingSchema, input, (ctx, data) => meetings.updateMeeting(ctx, data));
}

export async function deleteMeetingAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => meetings.deleteMeeting(ctx, data.id));
}

export async function createAgendaItemAction(input: unknown) {
  return runAction(createAgendaItemSchema, input, (ctx, data) => meetings.createAgendaItem(ctx, data));
}

export async function updateAgendaItemAction(input: unknown) {
  return runAction(updateAgendaItemSchema, input, (ctx, data) => meetings.updateAgendaItem(ctx, data));
}

export async function deleteAgendaItemAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => meetings.deleteAgendaItem(ctx, data.id));
}

export async function reorderAgendaAction(input: unknown) {
  return runAction(reorderAgendaSchema, input, (ctx, data) => meetings.reorderAgenda(ctx, data));
}

export async function listAgendaRelationCandidatesAction(input: unknown) {
  return runAction(agendaRelationCandidatesSchema, input, (ctx, data) => meetings.listAgendaRelationCandidates(ctx, data));
}

export async function addAgendaRelationAction(input: unknown) {
  return runAction(addAgendaRelationSchema, input, (ctx, data) => meetings.addAgendaRelation(ctx, data));
}

export async function removeAgendaRelationAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => meetings.removeAgendaRelation(ctx, data.id));
}

export async function createIssueFromAgendaItemAction(input: unknown) {
  return runAction(createIssueFromAgendaSchema, input, (ctx, data) => meetings.createIssueFromAgendaItem(ctx, data));
}

export async function createDecisionFromAgendaItemAction(input: unknown) {
  return runAction(createDecisionFromAgendaSchema, input, (ctx, data) => meetings.createDecisionFromAgendaItem(ctx, data));
}
