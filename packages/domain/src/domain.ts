/** Domain constants shared by server and client. No server-only imports here. */

import type { MemberRole, TaskStatus } from "./constants";

export { CONVERSATION_KINDS, MEMBER_ROLES, TASK_STATUSES } from "./constants";
export type { ConversationKind, MemberRole, TaskStatus } from "./constants";
export type { GroupDTO, InvitationDTO, IssueRefDTO, MemberDTO, MilestoneDTO, ProjectDTO, TaskDTO } from "./dto";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  in_review: "Im Review",
  done: "Erledigt",
};

export const ROLE_LABEL: Record<MemberRole, string> = { admin: "Admin", member: "Mitglied" };

/** Muted identification colours for projects (used for a small dot only). */
export const PROJECT_COLORS = {
  slate: { label: "Grau", hex: "#8e8e93" },
  blue: { label: "Blau", hex: "#4a7fd4" },
  teal: { label: "Petrol", hex: "#3a9a9a" },
  green: { label: "Grün", hex: "#4f9a5c" },
  amber: { label: "Ocker", hex: "#c49a3a" },
  orange: { label: "Orange", hex: "#d2793f" },
  red: { label: "Rot", hex: "#c95353" },
  pink: { label: "Rosa", hex: "#c46a93" },
  purple: { label: "Violett", hex: "#8a6cc4" },
} as const;
export type ProjectColor = keyof typeof PROJECT_COLORS;
export const PROJECT_COLOR_KEYS = Object.keys(PROJECT_COLORS) as ProjectColor[];

export function projectColorHex(color: string): string {
  return (PROJECT_COLORS as Record<string, { hex: string }>)[color]?.hex ?? PROJECT_COLORS.slate.hex;
}

/** Invitations are valid for 7 days after (re)sending. */
export const INVITATION_TTL_DAYS = 7;

export function displayName(m: { fullName: string | null; email: string }): string {
  return m.fullName?.trim() || m.email.split("@")[0];
}

export function initials(m: { fullName: string | null; email: string }): string {
  const name = displayName(m);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}
