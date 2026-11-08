import "server-only";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { meetingUrlSchema } from "@vistoo/domain/validation";
import { assertAdmin, type AuthContext } from "../auth";
import { getDb } from "../db";
import { workspaces } from "@vistoo/database/schema";

/** Workspace settings. Only admins may change them. */

/** Sets or clears the meeting link (e.g. the Discord voice channel). */
export async function updateMeetingUrl(
  ctx: AuthContext,
  input: z.output<typeof meetingUrlSchema>,
): Promise<{ meetingUrl: string | null }> {
  assertAdmin(ctx);
  await getDb()
    .update(workspaces)
    .set({ meetingUrl: input.meetingUrl, updatedAt: new Date() })
    .where(eq(workspaces.id, ctx.workspaceId));
  return { meetingUrl: input.meetingUrl };
}
