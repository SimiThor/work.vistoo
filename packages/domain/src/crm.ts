import { z } from "zod";
import { LINK_LIMITS } from "./links";
import { boundedText, optionalCalendarDay, uuid, webUrlSchema } from "./validation";

/**
 * CRM for potential tourist attractions: contact status, owner, follow-ups
 * and an activity timeline (automatic + manual entries). Shared within the
 * workspace.
 */

export const ATTRACTION_STATUSES = [
  "new",
  "contacted",
  "interested",
  "in_discussion",
  "partner",
  "not_interested",
] as const;
export type AttractionStatus = (typeof ATTRACTION_STATUSES)[number];

export const ATTRACTION_STATUS_LABEL: Record<AttractionStatus, string> = {
  new: "Neu",
  contacted: "Kontaktiert",
  interested: "Interessiert",
  in_discussion: "Im Gespräch",
  partner: "Partner",
  not_interested: "Kein Interesse",
};

/** Muted dot colour per status (badges stay neutral otherwise). */
export const ATTRACTION_STATUS_COLOR: Record<AttractionStatus, string> = {
  new: "#8e8e93",
  contacted: "#4a7fd4",
  interested: "#c49a3a",
  in_discussion: "#8a6cc4",
  partner: "#4f9a5c",
  not_interested: "#c95353",
};

/** Key figures above the table. */
export const isContacted = (s: AttractionStatus) => s !== "new";
export const isInterested = (s: AttractionStatus) => s === "interested" || s === "in_discussion" || s === "partner";

export const MANUAL_ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;
export const SYSTEM_ACTIVITY_TYPES = ["created", "status_changed", "owner_changed", "follow_up_changed"] as const;
export const ACTIVITY_TYPES = [...MANUAL_ACTIVITY_TYPES, ...SYSTEM_ACTIVITY_TYPES] as const;
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number];
export type SystemActivityType = (typeof SYSTEM_ACTIVITY_TYPES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const MANUAL_ACTIVITY_LABEL: Record<ManualActivityType, string> = {
  call: "Anruf",
  email: "E-Mail",
  meeting: "Meeting",
  note: "Notiz",
};

/** Manual activities that count as contact ("Letzter Kontakt"). */
export const CONTACT_ACTIVITY_TYPES: readonly ManualActivityType[] = ["call", "email", "meeting"];

export const isSystemActivity = (t: ActivityType): t is SystemActivityType =>
  (SYSTEM_ACTIVITY_TYPES as readonly string[]).includes(t);

export const CRM_LIMITS = { nameMax: 200, shortTextMax: 200, notesMax: 20000, activityMax: 5000 } as const;

export type AttractionDTO = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  contactName: string | null;
  status: AttractionStatus;
  ownerId: string | null;
  notes: string;
  /** Calendar day "YYYY-MM-DD". */
  nextFollowUp: string | null;
  /** Latest call / e-mail / meeting (instant). */
  lastContactAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** System entries keep the old and new value: status keys, user ids or calendar days. */
export type ActivityMetadata = { from?: string | null; to?: string | null };

export type ActivityDTO = {
  id: string;
  attractionId: string;
  type: ActivityType;
  system: boolean;
  description: string;
  metadata: ActivityMetadata;
  actorId: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

const name = boundedText(CRM_LIMITS.nameMax, "Der Name").min(1, { error: "Bitte gib einen Namen ein." });
/** Optional short text: empty input is stored as null. */
const optionalShort = (label: string) =>
  boundedText(CRM_LIMITS.shortTextMax, label)
    .transform((v) => v || null)
    .nullable();
const optionalWebsite = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(webUrlSchema.nullable())
  .nullable();
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(LINK_LIMITS.urlMax)
  .transform((v) => v || null)
  .pipe(z.email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }).nullable())
  .nullable();
const notes = z.string().max(CRM_LIMITS.notesMax, { error: "Die Notizen sind zu lang." });

const attractionFields = {
  name,
  city: optionalShort("Die Stadt"),
  country: optionalShort("Das Land"),
  website: optionalWebsite,
  email: optionalEmail,
  contactName: optionalShort("Der Ansprechpartner"),
  status: z.enum(ATTRACTION_STATUSES),
  ownerId: uuid.nullable(),
  notes,
  nextFollowUp: optionalCalendarDay,
};

export const createAttractionSchema = z.object({
  id: uuid.optional(),
  name,
  city: attractionFields.city.default(null),
  country: attractionFields.country.default(null),
  website: attractionFields.website.default(null),
  email: attractionFields.email.default(null),
  contactName: attractionFields.contactName.default(null),
  status: attractionFields.status.default("new"),
  ownerId: attractionFields.ownerId.default(null),
  notes: notes.default(""),
  nextFollowUp: optionalCalendarDay.default(null),
});

export const updateAttractionSchema = z.object({ id: uuid, patch: z.object(attractionFields).partial() });

const activityDescription = z
  .string()
  .trim()
  .max(CRM_LIMITS.activityMax, { error: `Höchstens ${CRM_LIMITS.activityMax} Zeichen.` });
const occurredAt = z.iso.datetime({ offset: true, error: "Ungültiger Zeitpunkt." });

export const createActivitySchema = z.object({
  id: uuid.optional(),
  attractionId: uuid,
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  description: activityDescription.default(""),
  /** Defaults to now. */
  occurredAt: occurredAt.optional(),
  /** Also sets the attraction's next follow-up (undefined = leave unchanged). */
  nextFollowUp: optionalCalendarDay.optional(),
});

export const updateActivitySchema = z.object({
  id: uuid,
  patch: z.object({ type: z.enum(MANUAL_ACTIVITY_TYPES), description: activityDescription, occurredAt }).partial(),
});
