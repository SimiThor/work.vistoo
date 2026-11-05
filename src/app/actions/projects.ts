"use server";

import { refresh } from "next/cache";
import { runAction } from "@/server/action";
import * as projects from "@/server/services/projects";
import {
  archiveProjectSchema,
  createGroupSchema,
  idSchema,
  projectSchema,
  renameGroupSchema,
  updateProjectSchema,
} from "@/lib/validation";

// Project/group changes affect server-rendered navigation and pickers,
// so the router is refreshed after each successful mutation.

async function withRefresh<T extends { ok: boolean }>(p: Promise<T>): Promise<T> {
  const result = await p;
  if (result.ok) refresh();
  return result;
}

export async function createProjectAction(input: unknown) {
  return withRefresh(runAction(projectSchema, input, (ctx, data) => projects.createProject(ctx, data)));
}

export async function updateProjectAction(input: unknown) {
  return withRefresh(runAction(updateProjectSchema, input, (ctx, data) => projects.updateProject(ctx, data)));
}

export async function setProjectArchivedAction(input: unknown) {
  return withRefresh(runAction(archiveProjectSchema, input, (ctx, data) => projects.setProjectArchived(ctx, data)));
}

export async function createGroupAction(input: unknown) {
  return withRefresh(runAction(createGroupSchema, input, (ctx, data) => projects.createGroup(ctx, data)));
}

export async function renameGroupAction(input: unknown) {
  return withRefresh(runAction(renameGroupSchema, input, (ctx, data) => projects.renameGroup(ctx, data)));
}

export async function deleteGroupAction(input: unknown) {
  return withRefresh(runAction(idSchema, input, (ctx, data) => projects.deleteGroup(ctx, data.id)));
}
