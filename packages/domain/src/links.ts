/**
 * External web links: task attachments (Google Drive, Figma, GitHub, …) and
 * the workspace's meeting link. Pure functions, shared by server and client.
 */

export const LINK_LIMITS = {
  urlMax: 2048,
  titleMax: 200,
  /** Attachments per task. */
  perTask: 50,
} as const;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Canonical form of user input: trims, adds `https://` to scheme-less input
 * ("figma.com/file/…") and returns the parsed href. Input that cannot be
 * parsed is returned trimmed (validation rejects it afterwards).
 */
export function normalizeWebUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const candidate = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).href;
  } catch {
    return trimmed;
  }
}

/**
 * Only http(s) URLs with a real host name and without embedded credentials.
 * Rejects `javascript:`, `data:`, `file:`, `mailto:` etc.
 */
export function isWebUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname;
  return host === "localhost" || (host.includes(".") && !host.startsWith(".") && !host.endsWith("."));
}

export type LinkKind = "drive" | "document" | "spreadsheet" | "presentation" | "figma" | "github" | "web";

/** Rough type of a link, used only to pick an icon. */
export function linkKind(value: string): LinkKind {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "web";
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;
  if (host === "docs.google.com") {
    if (path.startsWith("/spreadsheets")) return "spreadsheet";
    if (path.startsWith("/presentation")) return "presentation";
    return "document";
  }
  if (host === "drive.google.com") return "drive";
  if (host === "figma.com" || host.endsWith(".figma.com")) return "figma";
  if (host === "github.com" || host === "gist.github.com") return "github";
  return "web";
}

/** Label for a link without a title: host plus a shortened path ("github.com/vistoo/app/pull/12"). */
export function linkFallbackTitle(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
    const full = path ? `${host}${path}` : host;
    return full.length > 80 ? `${full.slice(0, 79)}…` : full;
  } catch {
    return value;
  }
}
