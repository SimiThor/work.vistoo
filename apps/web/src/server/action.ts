import "server-only";
import "./background";
import { z } from "zod";
import type { ActionResult } from "@vistoo/domain/result";
import { toErrorBody } from "@vistoo/backend/errors";
import { assertAdmin, requireMember, type AuthContext } from "./auth";

export function toActionError(err: unknown): ActionResult<never> {
  return { ok: false, error: toErrorBody(err) };
}

/**
 * Wraps a Server Action body: verifies identity + active membership on every
 * call, optionally requires the admin role, validates input, maps errors.
 * The HTTP API (/api/v1) does the same via @vistoo/backend/http.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  rawInput: unknown,
  fn: (ctx: AuthContext, input: z.output<S>) => Promise<T>,
  opts: { admin?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireMember();
    if (opts.admin) assertAdmin(ctx);
    const input = schema.parse(rawInput);
    const data = await fn(ctx, input);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
