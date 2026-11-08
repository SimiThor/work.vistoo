import { z } from "zod";
import { boundedText, uuid } from "./validation";

/** Shared idea backlog ("Ideen"): every active member can read and edit. */

export const IDEA_STATUSES = ["new", "considering", "planned", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  new: "Neu",
  considering: "In Prüfung",
  planned: "Geplant",
  archived: "Archiviert",
};

export const IDEA_LIMITS = { titleMax: 300, descriptionMax: 20000 } as const;

export type IdeaDTO = {
  id: string;
  title: string;
  description: string;
  status: IdeaStatus;
  createdBy: string;
  assigneeId: string | null;
  /** Issue created from this idea (null if none or deleted). */
  task: { id: string; title: string; projectId: string } | null;
  createdAt: string;
  updatedAt: string;
};

const ideaTitle = boundedText(IDEA_LIMITS.titleMax, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
const ideaDescription = z.string().max(IDEA_LIMITS.descriptionMax, { error: "Die Beschreibung ist zu lang." });

export const createIdeaSchema = z.object({
  id: uuid.optional(),
  title: ideaTitle,
  description: ideaDescription.default(""),
  status: z.enum(IDEA_STATUSES).default("new"),
  assigneeId: uuid.nullable().default(null),
});

export const updateIdeaSchema = z.object({
  id: uuid,
  patch: z
    .object({
      title: ideaTitle,
      description: ideaDescription,
      status: z.enum(IDEA_STATUSES),
      assigneeId: uuid.nullable(),
    })
    .partial(),
});

/** "Issue erstellen": a regular task in the chosen project, linked back to the idea. */
export const createIssueFromIdeaSchema = z.object({ ideaId: uuid, projectId: uuid });
