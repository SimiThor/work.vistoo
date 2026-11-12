import { z } from "zod";
import { APP_TIME_ZONE, isIsoDate } from "./dates";
import { boundedText, taskDescription, taskTitle, uuid, webUrlSchema } from "./validation";

/**
 * "Meetings": plan a meeting, prepare a shared agenda and keep the outcome of
 * every point. Every active member can read and edit (same model as
 * decisions). Times are entered and shown in the team's time zone
 * ({@link APP_TIME_ZONE}) and stored as instants (timestamptz).
 */

export const MEETING_LIMITS = {
  titleMax: 200,
  textMax: 20000,
  queryMax: 200,
  /** Agenda points per meeting. */
  agendaItemsPerMeeting: 100,
  /** Linked issues + decisions per agenda point. */
  relationsPerItem: 20,
  participantsMax: 100,
} as const;

export const AGENDA_STATUSES = ["open", "discussed"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];
export const AGENDA_STATUS_LABEL: Record<AgendaStatus, string> = { open: "Offen", discussed: "Besprochen" };

export const AGENDA_RELATION_KINDS = ["issue", "decision"] as const;
export type AgendaRelationKind = (typeof AGENDA_RELATION_KINDS)[number];

// ---------------------------------------------------------------------------
// Time zone handling (no library: Intl only, identical on server and client)
// ---------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isWallTime = (v: string) => TIME.test(v);

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormat(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

function wallParts(ms: number, tz: string) {
  const parts = partsFormat(tz).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC at the instant `ms` (e.g. +3_600_000 for CET). */
function offsetAt(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant of a wall-clock time in `tz` ("2026-11-12", "14:30" → 13:30Z in
 * winter, 12:30Z in summer). A time skipped by the spring DST change resolves
 * to the moment one hour later; an ambiguous autumn time to one of its occurrences.
 */
export function wallTimeToInstant(date: string, time: string, tz: string = APP_TIME_ZONE): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offsetAt(wall, tz);
  const o2 = offsetAt(wall - o1, tz);
  return new Date(wall - (o1 === o2 ? o1 : o2));
}

/** Calendar day and wall time of an instant in `tz`: { date: "2026-11-12", time: "14:30" }. */
export function instantToWallTime(iso: string | Date, tz: string = APP_TIME_ZONE): { date: string; time: string } {
  const p = wallParts(new Date(iso).getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Minutes between two wall times of the same day ("09:00", "10:30" → 90). */
export function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return toMin(end) - toMin(start);
}

/** Wall time `minutes` after `time`, capped at 23:59 (meetings end on their day). */
export function addMinutes(time: string, minutes: number): string {
  const total = Math.min(Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", { ...options, timeZone: APP_TIME_ZONE });
    fmtCache.set(key, f);
  }
  return f;
}

/** "Donnerstag, 12. November 2026" (team time zone). */
export const formatMeetingDay = (iso: string) =>
  fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/** "Do., 12. Nov." (adds the year if it is not the reference year). */
export function formatMeetingDayShort(iso: string, referenceYear = new Date().getFullYear()): string {
  const withYear = Number(instantToWallTime(iso).date.slice(0, 4)) !== referenceYear;
  return fmt(
    withYear
      ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
      : { weekday: "short", day: "numeric", month: "short" },
  ).format(new Date(iso));
}

/** "14:00" (team time zone). */
export const formatMeetingTime = (iso: string) => instantToWallTime(iso).time;

/** "14:00 – 15:30". */
export const formatMeetingTimeRange = (startsAt: string, endsAt: string) =>
  `${formatMeetingTime(startsAt)} – ${formatMeetingTime(endsAt)}`;

/** "45 Min.", "1 Std.", "1 Std. 30 Min." */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/**
 * Overview sections. A meeting counts as upcoming until it has ended, so a
 * running meeting stays on top. Upcoming: soonest first; past: latest first.
 */
export function splitMeetings<T extends { startsAt: string; endsAt: string }>(
  meetings: T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const t = now.getTime();
  const upcoming = meetings.filter((m) => new Date(m.endsAt).getTime() > t);
  const past = meetings.filter((m) => new Date(m.endsAt).getTime() <= t);
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}

export const isRunning = (m: { startsAt: string; endsAt: string }, now: Date = new Date()) =>
  new Date(m.startsAt).getTime() <= now.getTime() && now.getTime() < new Date(m.endsAt).getTime();

// ---------------------------------------------------------------------------
// Meeting links
// ---------------------------------------------------------------------------

export type MeetingProvider = "discord" | "meet" | "teams" | "zoom" | "webex" | "jitsi" | "web";
export const MEETING_PROVIDER_LABEL: Record<MeetingProvider, string> = {
  discord: "Discord",
  meet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  webex: "Webex",
  jitsi: "Jitsi",
  web: "Web",
};

/** Which service a meeting link belongs to (only used for labels). */
export function meetingProvider(url: string): MeetingProvider {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "web";
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is("discord.com") || is("discord.gg") || is("discordapp.com")) return "discord";
  if (is("meet.google.com")) return "meet";
  if (is("teams.microsoft.com") || is("teams.live.com")) return "teams";
  if (is("zoom.us") || is("zoom.com")) return "zoom";
  if (is("webex.com")) return "webex";
  if (is("meet.jit.si") || is("8x8.vc")) return "jitsi";
  return "web";
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** Row of the overview. */
export type MeetingSummaryDTO = {
  id: string;
  title: string;
  /** Instants (ISO 8601, UTC). */
  startsAt: string;
  endsAt: string;
  meetingUrl: string | null;
  participantIds: string[];
  agendaCount: number;
  discussedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Incremented on every edit of the meeting itself (optimistic concurrency). */
  version: number;
};

export type MeetingDTO = MeetingSummaryDTO & { description: string };

export type AgendaRelationDTO = {
  id: string;
  kind: AgendaRelationKind;
  targetId: string;
  title: string;
  /** Task status or decision status. */
  status: string;
  /** Issues only: project for the deep link. */
  projectId: string | null;
  /** Issues only: `#42`. */
  number: number | null;
};

export type AgendaRelationCandidateDTO = Omit<AgendaRelationDTO, "id">;

export type AgendaItemDTO = {
  id: string;
  meetingId: string;
  title: string;
  description: string;
  assignedTo: string | null;
  status: AgendaStatus;
  outcome: string;
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  relations: AgendaRelationDTO[];
};

export type MeetingDetailDTO = { meeting: MeetingDTO; agenda: AgendaItemDTO[] };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const title = boundedText(MEETING_LIMITS.titleMax, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
const itemTitle = boundedText(300, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
const longText = z.string().max(MEETING_LIMITS.textMax, { error: "Der Text ist zu lang." });
const day = z.string().refine(isIsoDate, { error: "Bitte wähle ein Datum." });
const wallTime = z.string().refine(isWallTime, { error: "Bitte gib eine Uhrzeit ein (hh:mm)." });

/** Date + start + end in the team's time zone; the meeting ends after it starts, on the same day. */
export const meetingTimesSchema = z
  .object({ date: day, startTime: wallTime, endTime: wallTime })
  .refine((v) => !isWallTime(v.startTime) || !isWallTime(v.endTime) || v.endTime > v.startTime, {
    error: "Die Endzeit muss nach der Startzeit liegen.",
    path: ["endTime"],
  });
export type MeetingTimes = z.infer<typeof meetingTimesSchema>;

/** Instants of validated wall times (server side, team time zone). */
export function meetingInstants(t: MeetingTimes): { startsAt: Date; endsAt: Date } {
  return { startsAt: wallTimeToInstant(t.date, t.startTime), endsAt: wallTimeToInstant(t.date, t.endTime) };
}

const participantIds = z
  .array(uuid)
  .max(MEETING_LIMITS.participantsMax, { error: "Zu viele Teilnehmende." })
  .transform((ids) => [...new Set(ids)]);

export const createMeetingSchema = z.object({
  /** Client-generated: makes retries idempotent. */
  id: uuid.optional(),
  title,
  times: meetingTimesSchema,
  participantIds: participantIds.default([]),
  meetingUrl: webUrlSchema.nullable().default(null),
  description: longText.default(""),
});
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const meetingPatchSchema = z
  .object({
    title,
    times: meetingTimesSchema,
    participantIds,
    meetingUrl: webUrlSchema.nullable(),
    description: longText,
  })
  .partial();

/** `version` = the version the editor started from (CONFLICT if someone saved in between). */
export const updateMeetingSchema = z.object({ id: uuid, version: z.int().positive(), patch: meetingPatchSchema });

export const createAgendaItemSchema = z.object({
  id: uuid.optional(),
  meetingId: uuid,
  title: itemTitle,
  description: longText.default(""),
  assignedTo: uuid.nullable().default(null),
});

export const agendaItemPatchSchema = z
  .object({
    title: itemTitle,
    description: longText,
    assignedTo: uuid.nullable(),
    status: z.enum(AGENDA_STATUSES),
    outcome: longText,
  })
  .partial();
export type AgendaItemPatch = z.input<typeof agendaItemPatchSchema>;

/** Text fields: changing them on a stale version is rejected instead of overwriting someone else's words. */
export const AGENDA_TEXT_FIELDS = ["title", "description", "outcome"] as const;

export const updateAgendaItemSchema = z.object({ id: uuid, version: z.int().positive(), patch: agendaItemPatchSchema });

/** New order of a meeting's agenda (ids missing here keep their relative order at the end). */
export const reorderAgendaSchema = z.object({
  meetingId: uuid,
  ids: z.array(uuid).max(MEETING_LIMITS.agendaItemsPerMeeting),
});

export const addAgendaRelationSchema = z.object({
  itemId: uuid,
  kind: z.enum(AGENDA_RELATION_KINDS),
  targetId: uuid,
});

export const agendaRelationCandidatesSchema = z.object({
  itemId: uuid,
  kind: z.enum(AGENDA_RELATION_KINDS),
  query: z.string().max(MEETING_LIMITS.queryMax).default(""),
});

/** "Issue erstellen" from an agenda point: the regular task fields, prefilled by the client. */
export const createIssueFromAgendaSchema = z.object({
  itemId: uuid,
  /** Client id of the new task (idempotent retries). */
  id: uuid.optional(),
  projectId: uuid,
  title: taskTitle,
  description: taskDescription.default(""),
  assigneeId: uuid.nullable().default(null),
});

export const createDecisionFromAgendaSchema = z.object({
  itemId: uuid,
  id: uuid.optional(),
  title: boundedText(300, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." }),
  description: longText.default(""),
});

// ---------------------------------------------------------------------------
// Prefills
// ---------------------------------------------------------------------------

/** Description of an issue / decision created from an agenda point: its description and outcome. */
export function agendaHandoffText(
  item: Pick<AgendaItemDTO, "description" | "outcome">,
  meeting: Pick<MeetingSummaryDTO, "title" | "startsAt">,
): string {
  const parts = [
    item.description.trim(),
    item.outcome.trim() ? `**Ergebnis aus dem Meeting:**\n\n${item.outcome.trim()}` : "",
    `_Aus dem Meeting „${meeting.title}“ am ${formatMeetingDay(meeting.startsAt)}._`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Calendar export (ICS, Google Calendar)
// ---------------------------------------------------------------------------

type CalendarMeeting = Pick<MeetingDTO, "id" | "title" | "description" | "startsAt" | "endsAt" | "meetingUrl" | "version">;

/** Plain-text body for calendar entries: link, description, agenda, back-link. */
export function calendarDetails(m: CalendarMeeting, agendaTitles: string[] = [], pageUrl?: string): string {
  const lines: string[] = [];
  if (m.meetingUrl) lines.push(`Meeting beitreten: ${m.meetingUrl}`, "");
  if (m.description.trim()) lines.push(m.description.trim(), "");
  if (agendaTitles.length) {
    lines.push("Agenda:");
    agendaTitles.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push("");
  }
  if (pageUrl) lines.push(`In Vistoo Work öffnen: ${pageUrl}`);
  return lines.join("\n").trim();
}

/** 20261112T130000Z */
function icsStamp(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 TEXT escaping. */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC 5545 line folding: at most 75 octets per line, continuation lines start with a space. */
function foldLine(line: string): string {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(line) <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74;
    if (bytes(current + ch) > limit) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

/**
 * iCalendar file with one event (Apple Calendar, Outlook, Google Calendar,
 * Thunderbird …). Times are UTC, so no VTIMEZONE block is needed. The UID is
 * stable and SEQUENCE follows the meeting version, so importing again after a
 * change updates the existing entry.
 */
export function buildIcs(
  m: CalendarMeeting,
  opts: { agendaTitles?: string[]; pageUrl?: string; now?: Date } = {},
): string {
  const description = calendarDetails(m, opts.agendaTitles, opts.pageUrl);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vistoo//Vistoo Work//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:meeting-${m.id}@work.vistoo`,
    `DTSTAMP:${icsStamp(opts.now ?? new Date())}`,
    `DTSTART:${icsStamp(m.startsAt)}`,
    `DTEND:${icsStamp(m.endsAt)}`,
    `SEQUENCE:${Math.max(0, m.version - 1)}`,
    `SUMMARY:${icsText(m.title)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(m.meetingUrl ? [`LOCATION:${icsText(m.meetingUrl)}`, `URL:${m.meetingUrl}`] : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Safe file name for the download ("Weekly Sync" → "weekly-sync.ics"). */
export function icsFileName(title: string): string {
  const base = title
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "meeting"}.ics`;
}

/** "Termin erstellen" in Google Calendar, prefilled (the user saves it themselves). */
export function googleCalendarUrl(m: CalendarMeeting, opts: { agendaTitles?: string[]; pageUrl?: string } = {}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title,
    dates: `${icsStamp(m.startsAt)}/${icsStamp(m.endsAt)}`,
    details: calendarDetails(m, opts.agendaTitles, opts.pageUrl),
    ctz: APP_TIME_ZONE,
  });
  if (m.meetingUrl) params.set("location", m.meetingUrl);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
