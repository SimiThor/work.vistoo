import { z } from "zod";
import { boundedText, optionalCalendarDay, uuid } from "./validation";

/**
 * Personal to-dos ("Meine To-dos"): private checklist per member, independent
 * of projects and tasks. Only the owner can read or change them.
 */

export const TODO_LIMITS = { titleMax: 300, descriptionMax: 5000, perUser: 500 } as const;

export type TodoDTO = {
  id: string;
  title: string;
  description: string;
  /** Calendar day "YYYY-MM-DD". */
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  /** Sort key among open to-dos (ascending). */
  position: number;
  createdAt: string;
  updatedAt: string;
};

const todoTitle = boundedText(TODO_LIMITS.titleMax, "Der Titel").min(1, { error: "Bitte gib einen Titel ein." });
const todoDescription = boundedText(TODO_LIMITS.descriptionMax, "Die Beschreibung");

export const createTodoSchema = z.object({
  /** Client id: a retried create returns the stored to-do. */
  id: uuid.optional(),
  title: todoTitle,
  description: todoDescription.default(""),
  dueDate: optionalCalendarDay.default(null),
});

export const updateTodoSchema = z.object({
  id: uuid,
  patch: z
    .object({ title: todoTitle, description: todoDescription, dueDate: optionalCalendarDay, completed: z.boolean() })
    .partial(),
});

/** New order of the open to-dos (top to bottom). */
export const reorderTodosSchema = z.object({ ids: z.array(uuid).min(1).max(TODO_LIMITS.perUser) });

/** Overdue = due before today (both calendar days, compared as strings). */
export function isOverdueDay(day: string | null, today: string | null): boolean {
  return Boolean(day && today && day < today);
}
