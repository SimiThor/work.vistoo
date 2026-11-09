"use server";

import { refresh } from "next/cache";
import { runAction } from "@/server/action";
import * as projects from "@vistoo/backend/services/projects";
import {
  archiveProjectSchema,
  createProjectSchema,
  updateProjectSchema,
} from "@vistoo/domain/validation";

// Project changes affect server-rendered navigation and pickers,
// so the router is refreshed after each successful mutation.

async function withRefresh<T extends { ok: boolean }>(p: Promise<T>): Promise<T> {
  const result = await p;
  if (result.ok) refresh();
  return result;
}

export async function createProjectAction(input: unknown) {
  return withRefresh(runAction(createProjectSchema, input, (ctx, data) => projects.createProject(ctx, data)));
}

export async function updateProjectAction(input: unknown) {
  return withRefresh(runAction(updateProjectSchema, input, (ctx, data) => projects.updateProject(ctx, data)));
}

export async function setProjectArchivedAction(input: unknown) {
  return withRefresh(runAction(archiveProjectSchema, input, (ctx, data) => projects.setProjectArchived(ctx, data)));
}
