"use server";

import { runAction } from "@/server/action";
import { resolveIssueRefs, searchIssues } from "@vistoo/backend/services/issue-refs";
import { getDb } from "@vistoo/backend/db";
import { resolveIssueRefsSchema, searchIssuesSchema } from "@vistoo/domain/validation";

/** `#` picker in the chat composer (same service as GET /api/v1/issue-refs). */
export async function searchIssuesAction(input: unknown) {
  return runAction(searchIssuesSchema, input, (ctx, data) => searchIssues(ctx, data));
}

/**
 * Display data for referenced tasks the client does not know yet (realtime
 * messages, restored drafts). Unknown, foreign or deleted ids are omitted.
 */
export async function resolveIssueRefsAction(input: unknown) {
  return runAction(resolveIssueRefsSchema, input, (ctx, data) => resolveIssueRefs(getDb(), ctx, data.ids));
}
