"use server";

import { refresh } from "next/cache";
import { runAction } from "@/server/action";
import * as team from "@vistoo/backend/services/team";
import { changeRoleSchema, idSchema, inviteSchema, profileNameSchema, userIdSchema } from "@vistoo/domain/validation";

async function withRefresh<T extends { ok: boolean }>(p: Promise<T>): Promise<T> {
  const result = await p;
  if (result.ok) refresh();
  return result;
}

export async function inviteMemberAction(input: unknown) {
  return withRefresh(runAction(inviteSchema, input, (ctx, data) => team.inviteMember(ctx, data), { admin: true }));
}

export async function resendInvitationAction(input: unknown) {
  return withRefresh(
    runAction(idSchema, input, (ctx, data) => team.resendInvitation(ctx, data.id), { admin: true }),
  );
}

export async function revokeInvitationAction(input: unknown) {
  return withRefresh(
    runAction(idSchema, input, (ctx, data) => team.revokeInvitation(ctx, data.id), { admin: true }),
  );
}

export async function changeMemberRoleAction(input: unknown) {
  return withRefresh(
    runAction(changeRoleSchema, input, (ctx, data) => team.changeMemberRole(ctx, data), { admin: true }),
  );
}

export async function removeMemberAction(input: unknown) {
  return withRefresh(
    runAction(userIdSchema, input, (ctx, data) => team.removeMember(ctx, data.userId), { admin: true }),
  );
}

export async function updateOwnNameAction(input: unknown) {
  return withRefresh(runAction(profileNameSchema, input, (ctx, data) => team.updateOwnName(ctx, data)));
}
