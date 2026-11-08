"use client";

import { ArrowRightLeft, CalendarClock, Mail, NotebookPen, Phone, Sparkles, UserRound, Users, type LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName, type MemberDTO } from "@vistoo/domain";
import {
  ATTRACTION_STATUS_COLOR,
  ATTRACTION_STATUS_LABEL,
  ATTRACTION_STATUSES,
  MANUAL_ACTIVITY_LABEL,
  type ActivityDTO,
  type ActivityType,
  type AttractionStatus,
} from "@vistoo/domain/crm";
import { formatLongDate } from "@vistoo/domain/dates";

export function AttractionStatusSelect({
  value,
  onChange,
  label,
  className,
  id,
  size = "sm",
}: {
  value: AttractionStatus;
  onChange: (s: AttractionStatus) => void;
  label?: string;
  className?: string;
  id?: string;
  size?: "sm" | "default";
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AttractionStatus)}>
      <SelectTrigger id={id} size={size} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ATTRACTION_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: ATTRACTION_STATUS_COLOR[s] }} />
            {ATTRACTION_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: NotebookPen,
  created: Sparkles,
  status_changed: ArrowRightLeft,
  owner_changed: UserRound,
  follow_up_changed: CalendarClock,
};

const statusLabel = (v: string | null | undefined) =>
  v && v in ATTRACTION_STATUS_LABEL ? ATTRACTION_STATUS_LABEL[v as AttractionStatus] : "–";

/** One sentence for an automatic entry, e.g. „Simon hat den Status von Kontaktiert auf Interessiert geändert.“ */
export function systemActivityText(a: ActivityDTO, people: Map<string, MemberDTO>): string {
  const name = (id: string | null | undefined) => {
    const m = id ? people.get(id) : undefined;
    return m ? displayName(m) : "Ehemaliges Mitglied";
  };
  const actor = name(a.actorId);
  const { from, to } = a.metadata;
  switch (a.type) {
    case "created":
      return `${actor} hat die Attraktion angelegt.`;
    case "status_changed":
      return `${actor} hat den Status von ${statusLabel(from)} auf ${statusLabel(to)} geändert.`;
    case "owner_changed":
      if (!to) return `${actor} hat die Verantwortung entfernt.`;
      return to === a.actorId ? `${actor} ist jetzt verantwortlich.` : `${name(to)} ist jetzt verantwortlich (durch ${actor}).`;
    case "follow_up_changed":
      return to ? `${actor} hat das nächste Follow-up auf ${formatLongDate(to)} gesetzt.` : `${actor} hat das Follow-up entfernt.`;
    default:
      return MANUAL_ACTIVITY_LABEL[a.type as keyof typeof MANUAL_ACTIVITY_LABEL] ?? "";
  }
}

/** Date + time in the viewer's time zone (only rendered on the client). */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** Value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
