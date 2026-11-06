/** Shared result shape returned by every Server Action. Safe for the client. */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "ARCHIVED"
  | "LAST_ADMIN"
  | "INTERNAL";

export type ActionError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  /** For CONFLICT: the current server state, so the UI can offer to reload it. */
  current?: unknown;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
