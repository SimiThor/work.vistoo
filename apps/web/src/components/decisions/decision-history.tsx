"use client";

import { ArrowRightLeft, CheckCircle2, History, PenLine, RotateCcw, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { formatDateTime } from "@/components/crm/crm-shared";
import { displayName, type MemberDTO } from "@vistoo/domain";
import { formatLongDate } from "@vistoo/domain/dates";
import {
  DECISION_STATUS_LABEL,
  fieldLabel,
  type DecisionHistoryDTO,
  type DecisionType,
  type HistoryKind,
  type TrackedField,
} from "@vistoo/domain/decisions";

const KIND_ICON: Record<HistoryKind, LucideIcon> = {
  concluded: CheckCircle2,
  edited: PenLine,
  reopened: RotateCcw,
  superseded: ArrowRightLeft,
};

function sentence(h: DecisionHistoryDTO, type: DecisionType, actor: string): string {
  const { fromStatus, toStatus, fields = [] } = h.details;
  const status = (s?: string) => (s ? DECISION_STATUS_LABEL[s as keyof typeof DECISION_STATUS_LABEL] : "–");
  switch (h.kind) {
    case "concluded":
      return `${actor} hat auf ${status(toStatus)} gesetzt.`;
    case "superseded":
      return `${actor} hat die Entscheidung ersetzt.`;
    case "reopened":
      return h.details.reason === "successor_deleted"
        ? "Wieder gültig, weil die ersetzende Entscheidung gelöscht wurde."
        : `${actor} hat von ${status(fromStatus)} auf ${status(toStatus)} zurückgesetzt.`;
    case "edited": {
      const names = fields.filter((f) => f !== "status").map((f) => fieldLabel(type, f));
      const parts = [
        ...(fromStatus && toStatus ? [`Status ${status(fromStatus)} → ${status(toStatus)}`] : []),
        ...(names.length ? [names.join(", ")] : []),
      ];
      return `${actor} hat ${parts.join(" sowie ")} geändert.`;
    }
  }
}

function formatPrevious(field: TrackedField, value: string | null): string {
  if (value === null || value === "") return "(leer)";
  if (field === "concludedOn") return formatLongDate(value);
  if (field === "status") return DECISION_STATUS_LABEL[value as keyof typeof DECISION_STATUS_LABEL] ?? value;
  return value;
}

/**
 * "Verlauf": what happened after the entry was concluded. Previous values of
 * edited fields can be expanded, so nothing is silently rewritten.
 */
export function DecisionHistory({
  history,
  type,
  people,
}: {
  history: DecisionHistoryDTO[];
  type: DecisionType;
  people: Map<string, MemberDTO>;
}) {
  const headingId = useId();
  if (history.length === 0) return null;
  const name = (id: string) => {
    const m = people.get(id);
    return m ? displayName(m) : "Ehemaliges Mitglied";
  };
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <History className="size-3.5" aria-hidden />
        Verlauf
      </h3>
      <ol className="space-y-2.5 border-l pl-4">
        {history.map((h) => {
          const Icon = KIND_ICON[h.kind];
          const previous = Object.entries(h.details.previous ?? {}) as [TrackedField, string | null][];
          return (
            <li key={h.id} className="relative text-sm">
              <span className="absolute top-0.5 -left-[25px] flex size-4 items-center justify-center rounded-full bg-background">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <p className="leading-snug">{sentence(h, type, name(h.actorId))}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
              {previous.length > 0 && (
                <details className="group mt-1">
                  <summary className="w-fit cursor-pointer list-none rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Vorherige Fassung anzeigen</span>
                    <span className="hidden group-open:inline">Vorherige Fassung ausblenden</span>
                  </summary>
                  <dl className="mt-1.5 space-y-2 rounded-lg bg-surface-subtle/70 px-3 py-2">
                    {previous.map(([field, value]) => (
                      <div key={field}>
                        <dt className="text-xs text-muted-foreground">{fieldLabel(type, field)}</dt>
                        <dd className="text-[13px] leading-relaxed whitespace-pre-wrap">{formatPrevious(field, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
