import { z } from "zod";
import type { ActionError, ErrorCode } from "@vistoo/domain/result";
import { fieldErrorsFrom } from "@vistoo/domain/validation";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extra?: { fieldErrors?: Record<string, string>; current?: unknown },
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Eintrag") => new AppError("NOT_FOUND", `${what} wurde nicht gefunden.`);
export const forbidden = (msg = "Dafür fehlt dir die Berechtigung.") => new AppError("FORBIDDEN", msg);
export const invalid = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError("VALIDATION", message, { fieldErrors });

/** Postgres error codes we translate into user-facing validation errors. */
function fromPgError(err: unknown): AppError | null {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
  const pg = e?.code ? e : (e?.cause as typeof e | undefined);
  if (!pg?.code) return null;
  const constraint = pg.constraint_name ?? pg.constraint ?? "";
  switch (pg.code) {
    case "23505":
      if (constraint.includes("conversations_channel_name")) {
        return new AppError("VALIDATION", "Einen Kanal mit diesem Namen gibt es bereits.", {
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

/**
 * Maps anything thrown by a service into the shared error shape used by
 * Server Actions and the HTTP API alike (same codes, same messages).
 */
export function toErrorBody(err: unknown): ActionError {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, ...err.extra };
  }
  if (err instanceof z.ZodError) {
    const fieldErrors = fieldErrorsFrom(err);
    return { code: "VALIDATION", message: Object.values(fieldErrors)[0] ?? "Ungültige Eingabe.", fieldErrors };
  }
  const pg = fromPgError(err);
  if (pg) return toErrorBody(pg);
  // Log without request payloads to avoid leaking user content or secrets.
  console.error("[backend] unexpected error:", err instanceof Error ? err.message : String(err));
  return { code: "INTERNAL", message: "Etwas ist schiefgelaufen. Bitte versuche es erneut." };
}
