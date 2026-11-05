/**
 * Calendar-day helpers. Task dates are plain calendar days ("YYYY-MM-DD"),
 * never instants. All arithmetic is done on integer day numbers derived via
 * Date.UTC, so the user's time zone can never shift a date.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Days since 1970-01-01 for a calendar date. */
export function toDayNumber(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Invalid calendar date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

export function fromDayNumber(day: number): string {
  const d = new Date(day * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Today's calendar date in the user's local time zone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(day: number): number {
  // 1970-01-01 was a Thursday (index 3).
  return (((day + 3) % 7) + 7) % 7;
}

export function isWeekend(day: number): boolean {
  return weekdayIndex(day) >= 5;
}

export function startOfWeek(day: number): number {
  return day - weekdayIndex(day);
}

/** ISO 8601 week number. */
export function isoWeek(day: number): number {
  const thursday = day - weekdayIndex(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1) / DAY_MS;
  return Math.floor((thursday - jan1) / 7) + 1;
}

/** Inclusive duration: same start and end = 1 day. */
export function durationDays(start: string, end: string): number {
  return toDayNumber(end) - toDayNumber(start) + 1;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" });
    fmtCache.set(key, f);
  }
  return f;
}

function asUtcDate(isoOrDay: string | number): Date {
  const day = typeof isoOrDay === "number" ? isoOrDay : toDayNumber(isoOrDay);
  return new Date(day * DAY_MS);
}

/** "5. Nov." (adds year if it differs from the reference year) */
export function formatShortDate(iso: string, referenceYear = new Date().getFullYear()): string {
  const d = asUtcDate(iso);
  const withYear = d.getUTCFullYear() !== referenceYear;
  return fmt(withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).format(d);
}

/** "Donnerstag, 5. November 2026" */
export function formatLongDate(iso: string): string {
  return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(asUtcDate(iso));
}

export function formatDayOfMonth(day: number): string {
  return String(new Date(day * DAY_MS).getUTCDate());
}

export function formatWeekdayShort(day: number): string {
  return fmt({ weekday: "short" }).format(asUtcDate(day)).replace(".", "");
}

export function formatMonthYear(day: number): string {
  return fmt({ month: "long", year: "numeric" }).format(asUtcDate(day));
}

export function formatRange(start: string | null, end: string | null): string {
  if (start && end) {
    return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
  }
  if (end) return `bis ${formatShortDate(end)}`;
  if (start) return `ab ${formatShortDate(start)}`;
  return "Kein Zeitraum";
}

/**
 * Instants (created_at, invitation expiry) are shown in the team's time zone
 * so server and client render identical text.
 */
export const APP_TIME_ZONE = "Europe/Berlin";

export function formatInstantDate(iso: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(iso));
}
