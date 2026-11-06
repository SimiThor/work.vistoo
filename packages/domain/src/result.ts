/** Shared result/error shape (Server Actions and HTTP API). Safe for any client. */

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "ARCHIVED",
  "LAST_ADMIN",
  "RATE_LIMITED",
  "CLIENT_OUTDATED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  /** For CONFLICT: the current server state, so the UI can offer to reload it. */
  current?: unknown;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
