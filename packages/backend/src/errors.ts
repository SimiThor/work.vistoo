import type { ErrorCode } from "@/lib/result";

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
