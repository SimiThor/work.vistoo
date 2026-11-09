import { z } from "zod";
import { APP_TIME_ZONE, isIsoDate } from "./dates";
import { LINK_LIMITS } from "./links";
import { boundedText, uuid, webUrlSchema } from "./validation";

/**
 * "Decisions": decisions and experiments of the team, documented once and
 * findable later. Both types share one record; each type has its own status
 * set and its own content fields. Every active member can read and edit.
 */

export const DECISION_TYPES = ["decision", "experiment"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const STATUSES_BY_TYPE = {
  decision: ["open", "in_discussion", "decided", "superseded"],
  experiment: ["planned", "testing", "adopted", "rejected", "inconclusive"],
} as const satisfies Record<DecisionType, readonly string[]>;

export const DECISION_STATUSES = [...STATUSES_BY_TYPE.decision, ...STATUSES_BY_TYPE.experiment] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Statuses that close an entry: they require a documented result and reasoning. */
export const CONCLUDED_STATUSES = ["decided", "superseded", "adopted", "rejected", "inconclusive"] as const;
export const isConcluded = (s: DecisionStatus) => (CONCLUDED_STATUSES as readonly string[]).includes(s);

export const isStatusOfType = (type: DecisionType, status: DecisionStatus) =>
  (STATUSES_BY_TYPE[type] as readonly string[]).includes(status);

/**
 * Today in the team's time zone ("YYYY-MM-DD"). Used for the automatic day of
 * a decision on server and client alike, so both agree regardless of where
 * the server runs or the viewer is.
 */
export function teamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const initialStatus = (type: DecisionType): DecisionStatus => STATUSES_BY_TYPE[type][0];

/**
 * Status after switching the type of an unconcluded entry: the matching
 * stage of the other type (open ↔ planned, in discussion ↔ testing).
 */
export function statusForType(type: DecisionType, status: DecisionStatus): DecisionStatus {
  if (isStatusOfType(type, status)) return status;
  return status === "in_discussion" || status === "testing" ? STATUSES_BY_TYPE[type][1] : initialStatus(type);
}

export const DECISION_TYPE_LABEL: Record<DecisionType, string> = { decision: "Entscheidung", experiment: "Experiment" };

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  open: "Offen",
  in_discussion: "In Diskussion",
  decided: "Entschieden",
  superseded: "Ersetzt",
  planned: "Geplant",
  testing: "Im Test",
  adopted: "Übernommen",
  rejected: "Verworfen",
  inconclusive: "Ohne klares Ergebnis",
};

/** Muted dot per status (same visual language as ideas and CRM). */
export const DECISION_STATUS_COLOR: Record<DecisionStatus, string> = {
  open: "#8e8e93",
  in_discussion: "#c49a3a",
  decided: "#4f9a5c",
  superseded: "#a3a3a8",
  planned: "#8e8e93",
  testing: "#4a7fd4",
  adopted: "#4f9a5c",
  rejected: "#c4554d",
  inconclusive: "#9b7fc4",
};

export const DECISION_LIMITS = {
  titleMax: 300,
  textMax: 20000,
  queryMax: 200,
  /** Links per entry. */
  linksPerEntry: 50,
  /** Linked issues + ideas per entry. */
  relationsPerEntry: 100,
  /** Length of the outcome preview in the list. */
  previewMax: 180,
} as const;

/** Long-form content fields. Which ones a type shows: {@link FIELDS_BY_TYPE}. */
export const DECISION_TEXT_FIELDS = [
  "description",
  "optionsConsidered",
  "objective",
  "testDescription",
  "results",
  "outcome",
  "reasoning",
] as const;
export type DecisionTextField = (typeof DECISION_TEXT_FIELDS)[number];

export const FIELDS_BY_TYPE: Record<DecisionType, readonly DecisionTextField[]> = {
  decision: ["description", "optionsConsidered", "outcome", "reasoning"],
  experiment: ["description", "results"],
};

/** Fields whose changes on a concluded entry are recorded in its history. */
export const TRACKED_FIELDS = ["title", ...DECISION_TEXT_FIELDS, "status", "concludedOn"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export function fieldLabel(type: DecisionType, field: TrackedField): string {
  switch (field) {
    case "title":
      return "Titel";
    case "description":
      return type === "decision" ? "Kontext" : "Beschreibung";
    case "optionsConsidered":
      return "Betrachtete Optionen";
    case "objective":
      return "Ziel";
    case "testDescription":
      return "Was wurde getestet";
    case "results":
      return "Ergebnis";
    case "outcome":
      return type === "decision" ? "Entscheidung" : "Fazit";
    case "reasoning":
      return "Begründung";
    case "status":
      return "Status";
    case "concludedOn":
      return type === "decision" ? "Entscheidungsdatum" : "Abschlussdatum";
  }
}

type CompletionValues = Pick<DecisionDTO, "type" | "status" | "results" | "outcome" | "reasoning">;

/**
 * What is missing to conclude an entry (empty object = complete). The server
 * enforces this; forms use it for immediate feedback.
 *   decision:   final decision + reasoning
 *   experiment: result (experiments only have description + result)
 */
export function completionErrors(
  v: CompletionValues,
): Partial<Record<"outcome" | "reasoning" | "results", string>> {
  if (!isConcluded(v.status)) return {};
  const errors: Partial<Record<"outcome" | "reasoning" | "results", string>> = {};
  const filled = (s: string) => s.trim() !== "";
  if (v.type === "experiment") {
    if (!filled(v.results)) errors.results = "Bitte halte das Ergebnis fest.";
    return errors;
  }
  if (!filled(v.outcome)) errors.outcome = "Bitte halte die finale Entscheidung fest.";
  if (!filled(v.reasoning)) errors.reasoning = "Bitte begründe den Abschluss.";
  return errors;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type DecisionRef = { id: string; title: string; status: DecisionStatus };

/** Row of the overview (no long texts except a short outcome preview). */
export type DecisionSummaryDTO = {
  id: string;
  type: DecisionType;
  title: string;
  status: DecisionStatus;
  assigneeId: string | null;
  createdBy: string;
  /** First characters of the decision / outcome (empty if none). */
  outcomePreview: string;
  /** Day of the decision / end of the experiment (concluded entries only). */
  concludedOn: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DecisionDTO = Omit<DecisionSummaryDTO, "outcomePreview"> &
  Record<DecisionTextField, string> & {
    /** The newer decision that replaced this one. */
    supersededBy: DecisionRef | null;
    /** Older decisions this one replaced. */
    supersedes: DecisionRef[];
  };

export type DecisionLinkDTO = {
  id: string;
  decisionId: string;
  url: string;
  title: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export const RELATION_KINDS = ["issue", "idea"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export type DecisionRelationDTO = {
  id: string;
  kind: RelationKind;
  targetId: string;
  title: string;
  /** Task status or idea status. */
  status: string;
  /** Issues only: project for the deep link. */
  projectId: string | null;
  /** Issues only: issue number (`#42`). */
  number: number | null;
};

export const HISTORY_KINDS = ["concluded", "edited", "reopened", "superseded"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** Stored with each history entry. `previous` holds the values before the change. */
export type HistoryDetails = {
  fields?: TrackedField[];
  previous?: Partial<Record<TrackedField, string | null>>;
  fromStatus?: DecisionStatus;
  toStatus?: DecisionStatus;
  /** "superseded": the replacing decision. */
  supersededBy?: string;
  /** "reopened" automatically because the replacing decision was deleted. */
  reason?: "successor_deleted";
};

export type DecisionHistoryDTO = {
  id: string;
  kind: HistoryKind;
  actorId: string;
  createdAt: string;
  details: HistoryDetails;
};

export type DecisionDetailDTO = {
  decision: DecisionDTO;
  links: DecisionLinkDTO[];
  relations: DecisionRelationDTO[];
  /** Newest first. */
  history: DecisionHistoryDTO[];
};

/** Overview row of a full record (after an edit in the detail panel). */
export function summaryOf(d: DecisionDTO): DecisionSummaryDTO {
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    status: d.status,
    assigneeId: d.assigneeId,
    createdBy: d.createdBy,
    outcomePreview: previewOf(d.outcome),
    concludedOn: d.concludedOn,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function previewOf(text: string): string {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > DECISION_LIMITS.previewMax ? `${line.slice(0, DECISION_LIMITS.previewMax - 1)}…` : line;
}

/** Search result for "Issue / Idee verknüpfen". */
export type RelationCandidateDTO = Omit<DecisionRelationDTO, "id">;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const title = boundedText(DECISION_LIMITS.titleMax, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
const longText = z.string().max(DECISION_LIMITS.textMax, { error: "Der Text ist zu lang." });
const day = z.string().refine(isIsoDate, { error: "Ungültiges Datum." });

export const DECISION_SORTS = ["updated", "created", "created_asc"] as const;
export type DecisionSort = (typeof DECISION_SORTS)[number];
export const DECISION_SORT_LABEL: Record<DecisionSort, string> = {
  updated: "Zuletzt geändert",
  created: "Zuletzt erstellt",
  created_asc: "Älteste zuerst",
};

/** "none" = entries without a responsible member. */
export const listDecisionsSchema = z.object({
  query: z.string().max(DECISION_LIMITS.queryMax).default(""),
  type: z.enum(DECISION_TYPES).nullable().default(null),
  status: z.enum(DECISION_STATUSES).nullable().default(null),
  assigneeId: z.union([uuid, z.literal("none")]).nullable().default(null),
  sort: z.enum(DECISION_SORTS).default("updated"),
});
export type DecisionListQuery = z.input<typeof listDecisionsSchema>;

export const createDecisionSchema = z.object({
  id: uuid.optional(),
  type: z.enum(DECISION_TYPES).default("decision"),
  title,
  description: longText.default(""),
  assigneeId: uuid.nullable().default(null),
});

export const decisionPatchSchema = z
  .object({
    type: z.enum(DECISION_TYPES),
    title,
    status: z.enum(DECISION_STATUSES),
    assigneeId: uuid.nullable(),
    description: longText,
    optionsConsidered: longText,
    objective: longText,
    testDescription: longText,
    results: longText,
    outcome: longText,
    reasoning: longText,
    /** Only for concluded entries; set automatically when concluding. */
    concludedOn: day,
  })
  .partial();
export type DecisionPatch = z.input<typeof decisionPatchSchema>;

export const updateDecisionSchema = z.object({ id: uuid, patch: decisionPatchSchema });

/** Replace a decided decision by an existing decision or by a new one (title). */
const supersedeFields = z.object({
  successorId: uuid.optional(),
  newTitle: title.optional(),
  /** Client id for the new decision (idempotent retries). */
  newId: uuid.optional(),
});
const exactlyOneSuccessor = [
  (v: z.infer<typeof supersedeFields>) => (v.successorId === undefined) !== (v.newTitle === undefined),
  { error: "Bitte wähle eine bestehende Entscheidung oder gib einen Titel ein." },
] as const;

/** Request body of the HTTP API (the decision id comes from the path). */
export const supersedeRequestSchema = supersedeFields.refine(...exactlyOneSuccessor);
export const supersedeDecisionSchema = supersedeFields.extend({ id: uuid }).refine(...exactlyOneSuccessor);

const linkTitle = boundedText(LINK_LIMITS.titleMax, "Der Name").nullable().default(null);

export const createDecisionLinkSchema = z.object({
  id: uuid.optional(),
  decisionId: uuid,
  url: webUrlSchema,
  title: linkTitle,
});
export const updateDecisionLinkSchema = z.object({ id: uuid, url: webUrlSchema, title: linkTitle });

export const addDecisionRelationSchema = z.object({
  decisionId: uuid,
  kind: z.enum(RELATION_KINDS),
  targetId: uuid,
});

export const relationCandidatesSchema = z.object({
  decisionId: uuid,
  query: z.string().max(DECISION_LIMITS.queryMax).default(""),
});

export const decisionIdSchema = z.object({ decisionId: uuid });
