import "server-only";
import { z } from "zod";
import type { ActionResult } from "@/lib/result";
import { fieldErrorsFrom } from "@/lib/validation";
import { assertAdmin, requireMember, type AuthContext } from "./auth";
import { AppError } from "./errors";

/** Postgres error codes we translate into user-facing validation errors. */
function fromPgError(err: unknown): AppError | null {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
  const pg = e?.code ? e : (e?.cause as typeof e | undefined);
  if (!pg?.code) return null;
  const constraint = pg.constraint_name ?? pg.constraint ?? "";
  switch (pg.code) {
    case "23505":
      if (constraint.includes("project_groups_project_name")) {
        return new AppError("VALIDATION", "Eine Gruppe mit diesem Namen gibt es in diesem Projekt bereits.", {
          fieldErrors: { name: "Dieser Name ist bereits vergeben." },
        });
      }
      return new AppError("CONFLICT", "Dieser Eintrag existiert bereits.");
    case "23503":
      return new AppError("VALIDATION", "Ein verknüpfter Eintrag existiert nicht (mehr). Bitte lade die Seite neu.");
    case "23514":
      if (constraint === "tasks_date_range") {
        return new AppError("VALIDATION", "Das Enddatum darf nicht vor dem Startdatum liegen.", {
          fieldErrors: { endDate: "Das Enddatum darf nicht vor dem Startdatum liegen." },
        });
      }
      if (constraint === "tasks_assignee_active") {
        return new AppError("VALIDATION", "Diese Person ist kein aktives Mitglied mehr.");
      }
      return new AppError("VALIDATION", "Die Eingabe ist ungültig.");
    default:
      return null;
  }
}

export function toActionError(err: unknown): ActionResult<never> {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message, ...err.extra } };
  }
  if (err instanceof z.ZodError) {
    const fieldErrors = fieldErrorsFrom(err);
    return {
      ok: false,
      error: { code: "VALIDATION", message: Object.values(fieldErrors)[0] ?? "Ungültige Eingabe.", fieldErrors },
    };
  }
  const pg = fromPgError(err);
  if (pg) return toActionError(pg);
  // Log without request payloads to avoid leaking user content or secrets.
  console.error("[action] unexpected error:", err instanceof Error ? err.message : String(err));
  return { ok: false, error: { code: "INTERNAL", message: "Etwas ist schiefgelaufen. Bitte versuche es erneut." } };
}

/**
 * Wraps a Server Action body: verifies identity + active membership on every
 * call, optionally requires the admin role, validates input, maps errors.
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
